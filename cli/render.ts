import { createCanvas, loadImage, type Image } from '@napi-rs/canvas'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'
import {
  artworkIdFor,
  artworkPath,
  imageIdFor,
  nodesPath,
  outFormat,
  outLocale,
  outPath,
  screensFor,
  settingsFor,
  sourcePath,
  type NodesLookup,
} from '../src/project/bridge'
import { isSlotSticker, slotScreens } from '../src/project/types'
import type { NodesFile, Project, ProjectSet } from '../src/project/types'
import { renderScene, sceneSpan } from '../src/render/scene'
import { isChipElement, isStickerElement } from '../src/types'
import { fitChipText, measureTextBlock, type TextMeasurer } from '../src/render/text'
import { effectiveSettings } from '../src/lib/settings'
import { getLayout } from '../src/presets/layouts'
import { getSize } from '../src/presets/sizes'
import { CliError } from './errors'
import { registerFonts } from './fonts'

type Options = { project: Project; repoRoot: string; targetIds?: string[]; localeIds?: string[] }

function rgbPng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const png = new PNG({ width, height })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  return PNG.sync.write(png, { colorType: 2 })
}

export const WEBP_QUALITY = 90

function webp(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(width, height)
  image.data.set(rgba)
  ctx.putImageData(image, 0, 0)
  return canvas.encodeSync('webp', WEBP_QUALITY)
}

/** Each capture's nodes file, read once; a file that is not JSON comes back as an empty object,
 *  which `validateProject` then reports as malformed. */
export function nodesLookup(repoRoot: string, set: ProjectSet): NodesLookup {
  const read = new Map<string, NodesFile | null>()
  return (localeId, screen) => {
    const path = join(repoRoot, nodesPath(set, localeId, screen))
    if (!read.has(path)) {
      let file: NodesFile | null = null
      if (existsSync(path)) {
        try {
          file = JSON.parse(readFileSync(path, 'utf8')) as NodesFile
        } catch {
          file = {} as NodesFile
        }
      }
      read.set(path, file)
    }
    return read.get(path)!
  }
}

function pick<T extends { id: string }>(all: T[], wanted: string[] | undefined, kind: string): T[] {
  if (!wanted) return all
  for (const id of wanted) {
    if (!all.some((item) => item.id === id)) throw new CliError(`Unknown ${kind} ${id}`, 2)
  }
  return all.filter((item) => wanted.includes(item.id))
}

/**
 * The file name this target actually writes for one locale, turned into a regex: `{n}` matches
 * any run of digits, `{storeLocale}`/`{locale}` match this locale's own value, everything else is
 * literal. A previous run's file that does not match — a different target sharing the folder, or
 * something that was never forge's, like `icon.png` — is left alone instead of deleted on sight.
 */
export function outFilePattern(outTemplate: string, storeLocale: string): RegExp {
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const file = outTemplate.split('/').pop() ?? outTemplate
  const pattern = escapeRe(file)
    .replace(/\\\{n\\\}/g, '\\d+')
    .replace(/\\\{storeLocale\\\}/g, escapeRe(storeLocale))
    .replace(/\\\{locale\\\}/g, escapeRe(storeLocale))
  return new RegExp(`^${pattern}$`)
}

async function clearMatching(dir: string, pattern: RegExp) {
  await mkdir(dir, { recursive: true })
  for (const name of await readdir(dir)) if (pattern.test(name)) await unlink(join(dir, name))
}

export async function renderProject({ project, repoRoot, targetIds, localeIds }: Options): Promise<string[]> {
  registerFonts()
  const { set } = project
  const targets = pick(set.targets, targetIds, 'target')
  const locales = pick(set.locales, localeIds, 'locale')
  const written: string[] = []
  // One render pass owns each output folder: clearing per locale would wipe what an earlier
  // locale wrote whenever two locales or two targets share a directory.
  const cleared = new Set<string>()
  const nodes = nodesLookup(repoRoot, set)

  for (const locale of locales) {
    const images: Record<string, Image> = {}
    for (const slot of set.slots) {
      // Own screen plus any named partner — a trio arrangement names two of them.
      for (const screen of slotScreens(slot)) {
        const path = join(repoRoot, sourcePath(set, locale.id, screen))
        if (!existsSync(path))
          throw new Error(`Source image missing for slot ${slot.id}, locale ${locale.id}: ${path}`)
        images[imageIdFor(locale.id, screen)] = await loadImage(path)
      }
      if (slot.artwork) {
        const art = join(repoRoot, artworkPath(set, locale.id, slot.artwork))
        if (!existsSync(art))
          throw new Error(`Artwork image missing for slot ${slot.id}, locale ${locale.id}: ${art}`)
        images[artworkIdFor(locale.id, slot.artwork)] = await loadImage(art)
      }
      // Stickers share the artwork registry, keyed by the same id — a sticker reusing a slot's
      // own artwork file (or another sticker's) is read from disk only once. A shape has no
      // image to load.
      for (const el of (slot.elements ?? []).filter(isSlotSticker)) {
        const id = artworkIdFor(locale.id, el.artwork)
        if (images[id]) continue
        const art = join(repoRoot, artworkPath(set, locale.id, el.artwork))
        if (!existsSync(art))
          throw new Error(`Artwork image missing for slot ${slot.id}, locale ${locale.id}: ${art}`)
        images[id] = await loadImage(art)
      }
    }
    const screens = screensFor(project, locale.id, nodes)

    for (const target of targets) {
      const settings = settingsFor(project, target.id)
      const size = getSize(settings.sizeId)
      const storeLocale = outLocale(locale, target.id)
      const encode = outFormat(target) === 'webp' ? webp : rgbPng
      let n = 0
      for (const [i, screen] of screens.entries()) {
        const span = sceneSpan(screen, settings)
        const canvas = createCanvas(size.w * span, size.h)
        const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
        // Shrunk-to-the-floor copy still renders, just unreadably small. The GUI shows it;
        // an unattended render has to say so instead.
        const resolved = effectiveSettings(screen, settings)
        const block = measureTextBlock(
          ctx as unknown as TextMeasurer,
          size.w * span,
          size.w,
          size.h,
          getLayout(resolved.layout),
          screen,
          resolved,
        )
        if (block && !block.fits) {
          throw new CliError(
            `Headline does not fit for slot ${screen.id}, locale ${locale.id}: shorten the copy or lower headlineScale`,
            2,
          )
        }
        // A chip never wraps; below the shrink floor it is the same failure as an overlong
        // headline — abort an unattended render instead of writing an unreadably tiny pill.
        for (const el of (screen.elements ?? []).filter(isChipElement)) {
          const fit = fitChipText(
            ctx as unknown as TextMeasurer,
            el.text,
            resolved,
            el.width * size.w,
            el.size * size.h,
            screen.lang,
          )
          if (!fit.fits) {
            throw new CliError(
              `Chip text does not fit for slot ${screen.id}, chip ${el.id}, locale ${locale.id}: shorten the text or increase its width`,
              2,
            )
          }
        }
        const at = (k: number) => images[screens[(k + screens.length) % screens.length].imageId!] ?? null
        renderScene(ctx, size.w, size.h, screen, settings, {
          self: at(i) as unknown as CanvasImageSource,
          next: (screen.pairId ? (images[screen.pairId] ?? null) : at(i + 1)) as unknown as CanvasImageSource,
          prev: (screen.pairPrevId
            ? (images[screen.pairPrevId] ?? null)
            : at(i - 1)) as unknown as CanvasImageSource,
          artwork: (screen.artworkId ? (images[screen.artworkId] ?? null) : null) as CanvasImageSource | null,
          elements: Object.fromEntries(
            (screen.elements ?? [])
              .filter(isStickerElement)
              .map((el) => [el.imageId, (images[el.imageId] ?? null) as unknown as CanvasImageSource | null]),
          ),
          extra: screen.extraIds?.map((id) => (images[id] ?? null) as unknown as CanvasImageSource | null),
        })
        for (let part = 0; part < span; part++) {
          const rgba = ctx.getImageData(part * size.w, 0, size.w, size.h).data
          const file = join(repoRoot, outPath(target, storeLocale, ++n))
          const dir = dirname(file)
          if (!cleared.has(dir)) {
            await clearMatching(dir, outFilePattern(target.out, storeLocale))
            cleared.add(dir)
          }
          await writeFile(file, encode(size.w, size.h, rgba))
          written.push(file)
        }
      }
    }
  }
  return written
}
