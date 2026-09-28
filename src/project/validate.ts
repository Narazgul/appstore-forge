import { AA_LARGE_TEXT, AA_NORMAL_TEXT, contrastAgainstBackground, contrastRatio } from '../lib/contrast'
import { effectiveSettings } from '../lib/settings'
import { DEVICES } from '../presets/devices'
import { getFont } from '../presets/fonts'
import { getLayout } from '../presets/layouts'
import { getPosition } from '../presets/positions'
import { resolveFontId } from '../presets/scripts'
import { EXPORT_SIZES } from '../presets/sizes'
import { parseMarkup } from '../render/text'
import { DEFAULT_SETTINGS } from '../store'
import type { Layout, Screen, Settings } from '../types'
import { DEFAULT_ARTWORK_SOURCES, artworkPath, sourcePath } from './bridge'
import { slotScreens } from './types'
import type { Project, ProjectSet, ProjectSlot, SlotElement } from './types'

export type Issue = { level: 'error' | 'warn'; message: string; slot?: string; locale?: string }

/** `drawTextBlock` in `render/text.ts` never paints the subhead fully opaque. */
const SUBHEAD_ALPHA = 0.72

/** `ratio < AA_LARGE_TEXT` blocks, `AA_LARGE_TEXT <= ratio < AA_NORMAL_TEXT` only warns. */
function contrastIssue(label: string, ratio: number, surface: string): Omit<Issue, 'slot' | 'locale'> | null {
  if (ratio < AA_LARGE_TEXT)
    return {
      level: 'error',
      message: `${label} contrast ${ratio.toFixed(1)}:1 on ${surface} (needs ${AA_LARGE_TEXT}:1)`,
    }
  if (ratio < AA_NORMAL_TEXT)
    return {
      level: 'warn',
      message: `${label} contrast ${ratio.toFixed(1)}:1 on ${surface} (needs ${AA_NORMAL_TEXT}:1)`,
    }
  return null
}

/** The arrangement a slot really renders in: the set's look, then the slot's own overrides. */
const positionOf = (set: ProjectSet, slot: ProjectSlot) =>
  getPosition(slot.overrides.positionId ?? set.settings.positionId ?? DEFAULT_SETTINGS.positionId)

/**
 * A sticker's box, approximated in the layout's own units: fractions of the composition width for
 * `x`/`left`/`right`, fractions of the tile height for `y`/`top`/`bottom`. The renderer draws the
 * real box from the image's aspect ratio (see `render/scene.ts`); here the height is only known
 * when `aspect` (width/height in pixels) is passed in, so an unknown image falls back to treating
 * the sticker as a square — good enough for a warning, not for a pixel claim.
 */
/** `tileAspect` is tile width / height: `width` counts in tile widths, the box height in tile heights. */
function stickerBox(el: SlotElement, span: number, aspect: number | null, tileAspect: number) {
  const halfWidthOfW = el.width / (2 * span)
  const heightFraction = (aspect ? el.width / aspect : el.width) * tileAspect
  return {
    left: el.x - halfWidthOfW,
    right: el.x + halfWidthOfW,
    top: el.y - heightFraction / 2,
    bottom: el.y + heightFraction / 2,
  }
}

/** The layout's text band in the same units as `stickerBox`, applying its "tile minus padX" default. */
function textBand(layout: Layout) {
  const text = layout.text!
  const left = text.left ?? layout.padX / layout.span
  const width = text.width ?? (1 - 2 * layout.padX) / layout.span
  return { left, right: left + width, top: text.top, bottom: text.top + text.height }
}

const boxesOverlap = (
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

export function validateProject(
  project: Project,
  sourceExists: (localeId: string, screen: string) => boolean,
  artworkExists: (localeId: string, artwork: string) => boolean = () => true,
  /** Whether a slot's eyebrow fits its box on one line at the final render size, per locale. */
  eyebrowFits: (localeId: string, slotId: string) => boolean = () => true,
  /** A sticker's image aspect ratio (width / height in pixels), when the check can know it. */
  elementAspect: (localeId: string, artwork: string) => number | null = () => null,
): Issue[] {
  const { set, copies } = project
  const issues: Issue[] = []
  const error = (message: string, where: { slot?: string; locale?: string } = {}) =>
    issues.push({ level: 'error', message, ...where })

  const artworkTemplate = set.artworkSources ?? DEFAULT_ARTWORK_SOURCES
  if (!artworkTemplate.includes('{artwork}')) error('artworkSources must contain {artwork}')
  const artworkPerLocale = artworkTemplate.includes('{locale}')

  for (const target of set.targets) {
    if (!EXPORT_SIZES.some((s) => s.id === target.sizeId)) error(`Unknown size ${target.sizeId}`)
    if (!DEVICES.some((d) => d.id === target.deviceId)) error(`Unknown device ${target.deviceId}`)
    for (const locale of set.locales) {
      if (!locale.store?.[target.id]) error(`No store locale for target ${target.id}`, { locale: locale.id })
    }
  }

  const seen = new Set<string>()
  for (const slot of set.slots) {
    if (seen.has(slot.id)) error(`Duplicate slot id ${slot.id}`, { slot: slot.id })
    seen.add(slot.id)
    if (slot.kind === 'artwork') error('Slot kind artwork is not supported yet', { slot: slot.id })
    const position = positionOf(set, slot)
    if (!slot.artwork && position.placements.some((p) => p.source === 'artwork'))
      error(`Arrangement ${position.id} needs an artwork, but the slot names none`, { slot: slot.id })
    if (slot.note?.trim())
      issues.push({ level: 'warn', message: `Open feedback: ${slot.note.trim()}`, slot: slot.id })

    const elementIds = new Set<string>()
    for (const el of slot.elements ?? []) {
      if (elementIds.has(el.id)) error(`Duplicate sticker id ${el.id}`, { slot: slot.id })
      elementIds.add(el.id)
      if (![el.x, el.y, el.width, el.rotate ?? 0].every(Number.isFinite))
        error(`Sticker ${el.id} has a non-finite position, size or rotation`, { slot: slot.id })
      else if (el.width <= 0) error(`Sticker ${el.id} has width <= 0`, { slot: slot.id })
    }
  }

  // One artwork may serve every language; reporting the same missing file 19 times helps nobody.
  const artworkReported = new Set<string>()
  for (const locale of set.locales) {
    const copy = copies[locale.id] ?? {}
    for (const slot of set.slots) {
      for (const screen of slotScreens(slot)) {
        if (!sourceExists(locale.id, screen))
          error(`Source image missing: ${sourcePath(set, locale.id, screen)}`, {
            slot: slot.id,
            locale: locale.id,
          })
      }
      if (slot.artwork) {
        const path = artworkPath(set, locale.id, slot.artwork)
        if (!artworkReported.has(path)) {
          artworkReported.add(path)
          if (!artworkExists(locale.id, slot.artwork))
            error(
              `Artwork image missing: ${path}`,
              artworkPerLocale ? { slot: slot.id, locale: locale.id } : { slot: slot.id },
            )
        }
      }
      // A sticker's artwork is resolved and reported exactly like the slot's own — same template,
      // same wording — so two stickers sharing one file never repeat the message either.
      for (const el of slot.elements ?? []) {
        const path = artworkPath(set, locale.id, el.artwork)
        if (!artworkReported.has(path)) {
          artworkReported.add(path)
          if (!artworkExists(locale.id, el.artwork))
            error(
              `Artwork image missing: ${path}`,
              artworkPerLocale ? { slot: slot.id, locale: locale.id } : { slot: slot.id },
            )
        }
      }
      if (!copy[slot.id]?.headline?.trim()) error('Headline missing', { slot: slot.id, locale: locale.id })
      if (copy[slot.id]?.eyebrow && !eyebrowFits(locale.id, slot.id))
        error('Eyebrow does not fit on one line', { slot: slot.id, locale: locale.id })
    }
    for (const slotId of Object.keys(copy)) {
      if (!seen.has(slotId))
        issues.push({ level: 'warn', message: 'Copy for unknown slot', slot: slotId, locale: locale.id })
    }
  }

  // The global font plus every slot override that names one — each is a face that might not
  // cover a given locale's script and silently redraw in Inter (see `resolveFontId`).
  const fontIds = new Set<string>([set.settings.fontId ?? DEFAULT_SETTINGS.fontId])
  for (const slot of set.slots)
    fontIds.add(slot.overrides.fontId ?? set.settings.fontId ?? DEFAULT_SETTINGS.fontId)
  for (const locale of set.locales) {
    for (const fontId of fontIds) {
      if (resolveFontId(fontId, locale.id) !== fontId)
        issues.push({
          level: 'warn',
          message: `Font "${getFont(fontId).label}" does not cover locale "${locale.id}"; falls back to Inter`,
          locale: locale.id,
        })
    }
  }
  // A slot's eyebrow is a deliberate choice, not a default — one locale carrying it while
  // another does not is worth a look before shipping, but not an error.
  for (const slot of set.slots) {
    const presence = set.locales.map((l) => !!copies[l.id]?.[slot.id]?.eyebrow?.trim())
    if (presence.some(Boolean) && presence.some((has) => !has))
      issues.push({ level: 'warn', message: 'Eyebrow set for some locales but not others', slot: slot.id })
  }

  // Contrast. Colours are locale-independent (overrides never vary by locale), so each slot is
  // resolved once — exactly as the renderer resolves it, including an active "contrast tile" —
  // but subhead/eyebrow/highlight checks only fire when some locale actually carries that text.
  const globalSettings: Settings = { ...DEFAULT_SETTINGS, ...set.settings }
  for (const slot of set.slots) {
    const screen: Screen = {
      id: slot.id,
      headline: '',
      subhead: '',
      imageId: null,
      overrides: slot.overrides,
    }
    const effective = effectiveSettings(screen, globalSettings)
    const push = (issue: Omit<Issue, 'slot' | 'locale'> | null) => {
      if (issue) issues.push({ ...issue, slot: slot.id })
    }

    // A 'behind' sticker sits under the text block and can never cover it; a 'front' one is drawn
    // last, over everything. The box is only ever approximate: `elementAspect` gives the real
    // aspect ratio when the check has loaded the image, otherwise the sticker is treated as a square.
    const layout = getLayout(effective.layout)
    if (layout.text) {
      const band = textBand(layout)
      const tileAspects = (set.targets.length ? set.targets : [{ sizeId: EXPORT_SIZES[0].id }]).map((t) => {
        const size = EXPORT_SIZES.find((s) => s.id === t.sizeId) ?? EXPORT_SIZES[0]
        return size.w / size.h
      })
      for (const el of slot.elements ?? []) {
        if ((el.layer ?? 'front') !== 'front') continue
        const aspect = elementAspect(set.locales[0]?.id ?? '', el.artwork)
        if (
          tileAspects.some((tileAspect) =>
            boxesOverlap(stickerBox(el, layout.span, aspect, tileAspect), band),
          )
        )
          issues.push({
            level: 'warn',
            message: `Sticker "${el.id}" may cover the headline (box approximated from width${aspect ? " and the image's aspect ratio" : ' as a square, since the image size is not known here'})`,
            slot: slot.id,
          })
      }
    }

    push(
      contrastIssue(
        'Headline',
        contrastAgainstBackground(effective.textColor, effective.background),
        'background',
      ),
    )

    const hasSubhead = set.locales.some((l) => copies[l.id]?.[slot.id]?.subhead?.trim())
    if (hasSubhead) {
      const ratio = contrastAgainstBackground(effective.textColor, effective.background, SUBHEAD_ALPHA)
      push(contrastIssue('Subhead', ratio, 'background'))
    }

    const hasEyebrow = set.locales.some((l) => copies[l.id]?.[slot.id]?.eyebrow?.trim())
    if (hasEyebrow) {
      const eyebrowColor = effective.eyebrowColor ?? effective.textColor
      push(
        contrastIssue('Eyebrow', contrastAgainstBackground(eyebrowColor, effective.background), 'background'),
      )
    }

    // Every span a `*starred*` headline actually uses, in any locale — mirrors how drawLine in
    // render/text.ts picks `highlights[span % highlights.length]`.
    const spans = new Set<number>()
    for (const locale of set.locales) {
      for (const word of parseMarkup(copies[locale.id]?.[slot.id]?.headline ?? ''))
        if (word.span >= 0) spans.add(word.span)
    }
    const highlightColors = new Set<string>()
    for (const span of spans) highlightColors.add(effective.highlights[span % effective.highlights.length])
    for (const color of highlightColors)
      push(contrastIssue('Headline', contrastRatio(effective.textColor, color), 'highlight'))
  }

  return issues
}
