import { effectiveSettings } from '../lib/settings'
import { getLayout } from '../presets/layouts'
import { getSize } from '../presets/sizes'
import { sceneSpan, textShifts } from '../render/scene'
import {
  headlineBaseSize,
  LIST_CAP_MULT,
  measureListBlock,
  measureTextBlock,
  textBlockBox,
  type TextMeasurer,
} from '../render/text'
import { meanColorIn, paintBackground } from '../render/textBackdrop'
import type { Screen } from '../types'
import { screensFor, settingsFor } from './bridge'
import type { Project } from './types'
import type { TextBlockProbe } from './validate'

/**
 * The measuring half of `forge check`, shared by the CLI (Skia) and the browser (the GUI's own
 * canvas): each checker asks the renderer's text functions where the copy lands, so a check in
 * the backoffice measures exactly what the CLI measures. `context` makes a fresh 2D context of a
 * size; its fonts must already be registered or loaded.
 */
export type ContextFactory = (w: number, h: number) => CanvasRenderingContext2D

/**
 * Whether each slot's eyebrow fits its box on one line, per locale, at the size the block
 * settles on for each target. A slot fits only if it does for every target the set renders —
 * one target's copy shrinks the text differently than another's.
 */
export function eyebrowFitsChecker(
  project: Project,
  context: ContextFactory,
): (localeId: string, slotId: string) => boolean {
  const fits = new Map<string, boolean>()
  for (const target of project.set.targets) {
    const settings = settingsFor(project, target.id)
    const size = getSize(settings.sizeId)
    for (const locale of project.set.locales) {
      for (const screen of screensFor(project, locale.id)) {
        if (!screen.eyebrow) continue
        const resolved = effectiveSettings(screen, settings)
        const span = sceneSpan(screen, settings)
        const ctx = context(size.w * span, size.h) as unknown as TextMeasurer
        const block = measureTextBlock(
          ctx,
          size.w * span,
          size.w,
          size.h,
          getLayout(resolved.layout),
          screen,
          resolved,
        )
        const key = `${locale.id}:${screen.id}`
        fits.set(key, (fits.get(key) ?? true) && (!block || block.eyebrowFits))
      }
    }
  }
  return (localeId, slotId) => fits.get(`${localeId}:${slotId}`) ?? true
}

/**
 * Whether each `feature-wall` slot's list fits its band, per locale, at the size it settles on
 * for each target — the same shape as `eyebrowFitsChecker`, capped the same way `render/scene.ts`
 * caps it (the headline's own base size × `LIST_CAP_MULT`).
 */
export function listFitsChecker(
  project: Project,
  context: ContextFactory,
): (localeId: string, slotId: string) => boolean {
  const fits = new Map<string, boolean>()
  for (const target of project.set.targets) {
    const settings = settingsFor(project, target.id)
    const size = getSize(settings.sizeId)
    for (const locale of project.set.locales) {
      for (const screen of screensFor(project, locale.id)) {
        if (!screen.list?.length) continue
        const resolved = effectiveSettings(screen, settings)
        const layout = getLayout(resolved.layout)
        const span = sceneSpan(screen, settings)
        const ctx = context(size.w * span, size.h) as unknown as TextMeasurer
        const capSize = headlineBaseSize(size.h, resolved, layout.textScale) * LIST_CAP_MULT
        const block = measureListBlock(ctx, size.w * span, size.w, size.h, layout, screen, resolved, capSize)
        const key = `${locale.id}:${screen.id}`
        fits.set(key, (fits.get(key) ?? true) && (!block || block.fits))
      }
    }
  }
  return (localeId, slotId) => fits.get(`${localeId}:${slotId}`) ?? true
}

/**
 * Where each slot's text block really lands, per locale, for every target: the renderer's own
 * `textShifts` + `textBlockBox`, called the way `render/targets.ts` frames the copy in the editor,
 * so `validateProject`'s headline checks see `textOffset` and `feature-wall`'s centring. Measured
 * only when asked — just the slots with a front sticker or a moved text block ever are.
 */
export function textBlockChecker(
  project: Project,
  context: ContextFactory,
): (localeId: string, slotId: string) => TextBlockProbe[] {
  const screens = new Map<string, Screen[]>()
  const measured = new Map<string, TextBlockProbe[]>()
  return (localeId, slotId) => {
    const key = `${localeId}:${slotId}`
    const known = measured.get(key)
    if (known) return known
    if (!screens.has(localeId)) screens.set(localeId, screensFor(project, localeId))
    const screen = screens.get(localeId)!.find((s) => s.id === slotId)
    if (!screen) return []
    const probes: TextBlockProbe[] = []
    for (const target of project.set.targets) {
      const settings = settingsFor(project, target.id)
      const size = getSize(settings.sizeId)
      const resolved = effectiveSettings(screen, settings)
      const layout = getLayout(resolved.layout)
      const W = size.w * layout.span
      const ctx = context(W, size.h) as unknown as TextMeasurer
      const shifts = textShifts(ctx, W, size.w, size.h, layout, screen, resolved)
      const box = textBlockBox(ctx, W, size.w, size.h, layout, screen, resolved, shifts.text)
      if (!box) continue
      probes.push({
        tileAspect: size.w / size.h,
        box: {
          left: box.x / W,
          right: (box.x + box.w) / W,
          top: box.y / size.h,
          bottom: (box.y + box.h) / size.h,
        },
      })
    }
    measured.set(key, probes)
    return probes
  }
}

/**
 * The mean colour of the background behind each slot's text block, per locale and target, for the
 * slots whose background carries an image: the background is painted the way `renderScene` paints
 * it (image, blur, brightness, finishes), the text block placed by the renderer's own functions.
 * `images` holds the background pictures that are there, by `src`; a missing one is reported by
 * `validateProject` itself, and such a slot falls back to the colour.
 */
export function textBackdropChecker(
  project: Project,
  images: Map<string, CanvasImageSource>,
  context: ContextFactory,
): (slotId: string) => string[] {
  if (!images.size) return () => []
  const screens = new Map(project.set.locales.map((l) => [l.id, screensFor(project, l.id)]))
  const measured = new Map<string, string[]>()
  return (slotId) => {
    const known = measured.get(slotId)
    if (known) return known
    const colors: string[] = []
    for (const target of project.set.targets) {
      const settings = settingsFor(project, target.id)
      const size = getSize(settings.sizeId)
      const painted = { key: '', ctx: undefined as CanvasRenderingContext2D | undefined }
      for (const locale of project.set.locales) {
        const screen = screens.get(locale.id)!.find((s) => s.id === slotId)
        if (!screen) continue
        const resolved = effectiveSettings(screen, settings)
        const image = resolved.background.image && images.get(resolved.background.image.src)
        if (!image) continue
        const layout = getLayout(resolved.layout)
        const W = size.w * layout.span
        const key = `${W}:${JSON.stringify(resolved.background)}`
        if (!painted.ctx || painted.key !== key) {
          painted.ctx = context(W, size.h)
          painted.key = key
          paintBackground(painted.ctx, W, size.w, size.h, resolved.background, image)
        }
        const ctx = painted.ctx
        const measurer = ctx as unknown as TextMeasurer
        const shifts = textShifts(measurer, W, size.w, size.h, layout, screen, resolved)
        const box = textBlockBox(measurer, W, size.w, size.h, layout, screen, resolved, shifts.text)
        const color = box && meanColorIn(ctx, box)
        if (color) colors.push(color)
      }
    }
    measured.set(slotId, colors)
    return colors
  }
}
