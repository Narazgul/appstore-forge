import {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  contrastAgainstBackground,
  contrastRatio,
  parseHexColor,
} from '../lib/contrast'
import { effectiveSettings } from '../lib/settings'
import { DEVICES } from '../presets/devices'
import { getFont } from '../presets/fonts'
import { getLayout } from '../presets/layouts'
import { getPosition } from '../presets/positions'
import { resolveFontId } from '../presets/scripts'
import { EXPORT_SIZES } from '../presets/sizes'
import { LIST_GAP } from '../render/scene'
import { parseMarkup } from '../render/text'
import { DEFAULT_SETTINGS } from '../store'
import { OFFSET_LIMIT } from '../types'
import type { Layout, Offset, Screen, Settings, ShapeKind } from '../types'
import {
  DEFAULT_ARTWORK_SOURCES,
  OUT_FORMATS,
  artworkPath,
  isNodeTarget,
  nodesFileProblem,
  nodesPath,
  resolveNode,
  sourcePath,
  type NodesLookup,
} from './bridge'
import {
  EFFECT_KINDS,
  TILE_ROLES,
  hasChipText,
  isSlotChip,
  isSlotEffect,
  isSlotMark,
  markTargets,
  isSlotShape,
  isSlotSticker,
  isStudioSet,
  slotScreens,
} from './types'
import { backgroundProblems, backgroundsToCheck } from './validateBackground'
import { frameSettingProblems, markNodes, markProblems, onScreen, rectProblem } from './validateMarks'
import type { Project, ProjectSet, ProjectSlot, SlotEffect, SlotElement, SlotSticker } from './types'

/** #rgb, #rrggbb or #rrggbbaa — the same reach as any CSS hex color the renderer's `fillStyle` accepts. */
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const SHAPE_KINDS: ShapeKind[] = ['circle', 'ring', 'blob']
const RING_STROKE_RANGE = { min: 0.02, max: 0.5 }
/** Exclusive at the low end (0 draws an invisible chip), inclusive at the high end. Below it
 *  `roundRect` gets a negative radius, a `RangeError` in the browser. */
const CHIP_SIZE_RANGE = { min: 0.005, max: 0.2 }

export type Issue = { level: 'error' | 'warn'; message: string; slot?: string; locale?: string }

/** A box in the units the headline checks use: `left`/`right` fractions of the composition width,
 *  `top`/`bottom` fractions of the tile height. */
export type Band = { left: number; right: number; top: number; bottom: number }

/** A slot's text block where the renderer really puts it for one target and locale, as a `Band`,
 *  with that target's tile aspect (width / height) — what `forge check` measures. */
export type TextBlockProbe = { tileAspect: number; box: Band }

/** What is wrong with a `deviceOffset`/`textOffset` value, or null when it is absent or fine: an
 *  object with finite `dx`/`dy`, each within ±`OFFSET_LIMIT`. */
function offsetProblem(value: unknown): string | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'must be an object { dx, dy }'
  const { dx, dy } = value as Record<string, unknown>
  if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy))
    return 'needs finite numbers dx and dy'
  if (Math.abs(dx) > OFFSET_LIMIT || Math.abs(dy) > OFFSET_LIMIT)
    return `dx ${dx} / dy ${dy} outside ±${OFFSET_LIMIT} (fractions of the composition width / tile height)`
  return null
}

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

const MOSAIC_MIN_EXTRA = 3
const MOSAIC_MAX_EXTRA = 5

/**
 * A sticker's box, approximated in the layout's own units: fractions of the composition width for
 * `x`/`left`/`right`, fractions of the tile height for `y`/`top`/`bottom`. The renderer draws the
 * real box from the image's aspect ratio (see `render/scene.ts`); here the height is only known
 * when `aspect` (width/height in pixels) is passed in, so an unknown image falls back to treating
 * the sticker as a square — good enough for a warning, not for a pixel claim.
 */
/** `tileAspect` is tile width / height: `width` counts in tile widths, the box height in tile heights. */
function stickerBox(el: SlotSticker, span: number, aspect: number | null, tileAspect: number) {
  const halfWidthOfW = el.width / (2 * span)
  const heightFraction = (aspect ? el.width / aspect : el.width) * tileAspect
  return {
    left: el.x - halfWidthOfW,
    right: el.x + halfWidthOfW,
    top: el.y - heightFraction / 2,
    bottom: el.y + heightFraction / 2,
  }
}

/**
 * Where a slot's text block lands when nothing measures it, in the same units as `stickerBox`: the
 * layout's text band (its "tile minus padX" default applied), moved by the tile's `textOffset`
 * exactly as `drawTextBlock` moves it. A layout with a list (`feature-wall`) stacks headline and
 * list as one group centred in the tile (`textShifts` in `render/scene.ts`), so where the headline
 * lands depends on how tall both came out. Unmeasured, its band vertically stands for every place
 * it can be: from the top of the tallest group (both blocks filling their bands) down to the tile's
 * middle, since the headline is the group's upper part.
 */
function approxTextBlock(layout: Layout, offset: Offset | undefined): Band {
  const text = layout.text!
  const left = text.left ?? layout.padX / layout.span
  const width = text.width ?? (1 - 2 * layout.padX) / layout.span
  const [top, bottom] = layout.list
    ? [(1 - text.height - LIST_GAP - layout.list.height) / 2, 0.5]
    : [text.top, text.top + text.height]
  const dx = offset?.dx ?? 0
  const dy = offset?.dy ?? 0
  return { left: left + dx, right: left + width + dx, top: top + dy, bottom: bottom + dy }
}

type Range = { min: number; max: number }
const EFFECT_FIELDS: Record<SlotEffect['effect'], Record<string, Range | readonly string[] | 'hex'>> = {
  lift: { scale: { min: 1, max: 1.5 }, dim: { min: 0, max: 0.9 }, gray: { min: 0, max: 1 } },
  loupe: {
    zoom: { min: 1.2, max: 4 },
    size: { min: 0.05, max: 0.9 },
    place: ['over', 'above', 'below', 'left', 'right'],
    ring: 'hex',
  },
  focus: { strength: { min: 0.002, max: 0.05 }, dim: { min: 0, max: 0.9 } },
  redact: { style: ['pixelate', 'blur'], strength: { min: 0.005, max: 0.1 } },
}
const EFFECT_COMMON = new Set(['id', 'effect', 'rect', 'node', 'pad'])
const PAD_RANGE: Range = { min: 0, max: 0.2 }

/** Everything wrong with one effect's own fields — its target and its settings, not yet whether a
 *  `node` resolves (that needs each locale's capture). */
function effectProblems(el: SlotEffect): string[] {
  const problems: string[] = []
  const fields = EFFECT_FIELDS[el.effect]
  if (!fields) return [`unknown effect "${el.effect}"; one of ${EFFECT_KINDS.join(', ')}`]
  const hasRect = el.rect !== undefined
  const hasNode = el.node !== undefined
  if (hasRect === hasNode) problems.push('needs exactly one of rect or node')
  if (hasNode && !isNodeTarget(el.node))
    problems.push('node must be a non-empty string or an array of at least two of them')
  const rect = hasRect ? rectProblem(el.rect) : null
  if (rect) problems.push(rect)
  if (
    el.pad !== undefined &&
    !(Number.isFinite(el.pad) && el.pad >= PAD_RANGE.min && el.pad <= PAD_RANGE.max)
  )
    problems.push(`pad ${el.pad} outside ${PAD_RANGE.min}–${PAD_RANGE.max}`)
  for (const [key, value] of Object.entries(el)) {
    if (value === undefined || EFFECT_COMMON.has(key)) continue
    const rule = fields[key]
    if (!rule) problems.push(`field ${key} does not apply to a ${el.effect}`)
    else if (rule === 'hex') {
      if (typeof value !== 'string' || !HEX_COLOR.test(value))
        problems.push(`${key} is not a hex colour: ${value}`)
    } else if (Array.isArray(rule)) {
      if (!rule.includes(value as string)) problems.push(`${key} must be one of ${rule.join(', ')}`)
    } else {
      const range = rule as Range
      if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max)
        problems.push(`${key} ${value} outside ${range.min}–${range.max}`)
    }
  }
  return problems
}

const boxesOverlap = (a: Band, b: Band) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
const within = (a: Band, b: Band) =>
  a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom

const TILE: Band = { left: 0, right: 1, top: 0, bottom: 1 }

export function validateProject(
  project: Project,
  sourceExists: (localeId: string, screen: string) => boolean,
  artworkExists: (localeId: string, artwork: string) => boolean = () => true,
  /** Whether a slot's eyebrow fits its box on one line at the final render size, per locale. */
  eyebrowFits: (localeId: string, slotId: string) => boolean = () => true,
  /** A sticker's image aspect ratio (width / height in pixels), when the check can know it. */
  elementAspect: (localeId: string, artwork: string) => number | null = () => null,
  /** Whether a `feature-wall` slot's list fits its band at the final render size, per locale. */
  listFits: (localeId: string, slotId: string) => boolean = () => true,
  /** Where a slot's text block really lands, per locale, for every target; absent, the headline
   *  checks fall back to `approxTextBlock`. */
  textBlocks: ((localeId: string, slotId: string) => TextBlockProbe[]) | null = null,
  /** The capture's nodes for one locale's screen, which an effect's `node` is looked up in. */
  nodes: NodesLookup = () => null,
  /** Whether a background image (a path from the repo root) is there. */
  backgroundExists: (src: string) => boolean = () => true,
): Issue[] {
  const { set, copies } = project
  const issues: Issue[] = []
  const error = (message: string, where: { slot?: string; locale?: string } = {}) =>
    issues.push({ level: 'error', message, ...where })

  const studio = isStudioSet(set)
  if (set.purpose !== undefined && set.purpose !== 'store' && set.purpose !== 'studio')
    error(`Unknown purpose "${set.purpose}"`)
  if (studio && !set.locales.length) error('A studio set needs at least one locale')

  const artworkTemplate = set.artworkSources ?? DEFAULT_ARTWORK_SOURCES
  if (!artworkTemplate.includes('{artwork}')) error('artworkSources must contain {artwork}')
  const artworkPerLocale = artworkTemplate.includes('{locale}')

  // Resolved once, reused everywhere a slot's actual composition matters (span, layout, colours).
  const globalSettings: Settings = { ...DEFAULT_SETTINGS, ...set.settings }
  /** Slot-override, then set-setting, then default — the same order `effectiveSettings` resolves
   *  everything else in. Copy is irrelevant to which layout a slot draws, so the screen it builds
   *  carries none. */
  const layoutOf = (slot: ProjectSlot): Layout =>
    getLayout(
      effectiveSettings(
        { id: slot.id, headline: '', subhead: '', imageId: null, overrides: slot.overrides },
        globalSettings,
      ).layout,
    )
  const slotLayouts = new Map(set.slots.map((slot): [string, Layout] => [slot.id, layoutOf(slot)]))
  // A hand-edited project file may carry the wrong JSON shape for either field (a string instead
  // of an array, say) — every read below goes through these instead of the raw slot field, so a
  // wrong type never reaches a `.map`/`.filter`/spread and throws; the per-slot loop below reports
  // it as a validation error once, up front.
  const elementsOf = new Map<string, SlotElement[]>(
    set.slots.map((slot) => [slot.id, Array.isArray(slot.elements) ? slot.elements : []]),
  )
  const extraOf = new Map<string, string[]>(
    set.slots.map((slot) => [slot.id, Array.isArray(slot.extra) ? slot.extra : []]),
  )

  // A target's `out` needs `{n}` to keep two tiles from overwriting each other — unless the set
  // can only ever produce one tile per target and locale in the first place. Span depends only on
  // the layout, which does not vary by target or locale, so this is safe to compute once.
  const oneTileOnly = set.slots.length === 1 && slotLayouts.get(set.slots[0].id)!.span === 1

  for (const target of set.targets) {
    if (!EXPORT_SIZES.some((s) => s.id === target.sizeId)) error(`Unknown size ${target.sizeId}`)
    if (!DEVICES.some((d) => d.id === target.deviceId)) error(`Unknown device ${target.deviceId}`)
    if (!target.out.includes('{n}') && !oneTileOnly)
      error(`Target ${target.id}: out must contain {n} unless the set renders exactly one tile per locale`)
    const ext = target.out.slice(target.out.lastIndexOf('.')).toLowerCase()
    if (!(OUT_FORMATS as readonly string[]).includes(ext))
      error(`Target ${target.id}: out must end in ${OUT_FORMATS.join(' or ')}`)
    else if (ext === '.webp' && !studio)
      error(`Target ${target.id}: the stores take no WebP; only a studio set writes it`)
    if (studio) {
      if (set.locales.length > 1 && !/\{(storeLocale|locale)\}/.test(target.out))
        error(`Target ${target.id}: out must contain {locale} when the set has more than one locale`)
      continue
    }
    for (const locale of set.locales) {
      if (!locale.store?.[target.id]) error(`No store locale for target ${target.id}`, { locale: locale.id })
    }
  }

  const validHexColor = (color: string) => {
    try {
      parseHexColor(color)
      return true
    } catch {
      return false
    }
  }
  const validSubheadStyle = (style: unknown): boolean => style === 'plain' || style === 'label'
  const validDeviceShadow = (style: unknown): boolean =>
    style === 'soft' || style === 'hard' || style === 'none'
  if (set.settings.accentBar != null && !validHexColor(set.settings.accentBar))
    error(`accentBar is not a hex colour: ${set.settings.accentBar}`)
  if (set.settings.subheadStyle !== undefined && !validSubheadStyle(set.settings.subheadStyle))
    error(`Unknown subheadStyle "${set.settings.subheadStyle}"`)
  if (set.settings.deviceShadow !== undefined && !validDeviceShadow(set.settings.deviceShadow))
    error(`Unknown deviceShadow "${set.settings.deviceShadow}"`)
  for (const key of ['deviceOffset', 'textOffset'] as const) {
    const problem = offsetProblem(set.settings[key])
    if (problem) error(`${key} ${problem}`)
  }
  for (const problem of frameSettingProblems(set.settings)) error(problem)

  for (const [bg, where] of backgroundsToCheck(set))
    for (const problem of backgroundProblems(bg, backgroundExists)) error(problem, where)

  const seen = new Set<string>()
  for (const slot of set.slots) {
    if (seen.has(slot.id)) error(`Duplicate slot id ${slot.id}`, { slot: slot.id })
    seen.add(slot.id)
    if (slot.overrides.accentBar != null && !validHexColor(slot.overrides.accentBar))
      error(`accentBar is not a hex colour: ${slot.overrides.accentBar}`, { slot: slot.id })
    if (slot.overrides.subheadStyle !== undefined && !validSubheadStyle(slot.overrides.subheadStyle))
      error(`Unknown subheadStyle "${slot.overrides.subheadStyle}"`, { slot: slot.id })
    if (slot.overrides.deviceShadow !== undefined && !validDeviceShadow(slot.overrides.deviceShadow))
      error(`Unknown deviceShadow "${slot.overrides.deviceShadow}"`, { slot: slot.id })
    for (const key of ['deviceOffset', 'textOffset'] as const) {
      const problem = offsetProblem(slot.overrides[key])
      if (problem) error(`${key} ${problem}`, { slot: slot.id })
    }
    for (const problem of frameSettingProblems(slot.overrides)) error(problem, { slot: slot.id })
    if (slot.elements !== undefined && !Array.isArray(slot.elements))
      error('elements must be an array', { slot: slot.id })
    if (slot.extra !== undefined && !Array.isArray(slot.extra))
      error('extra must be an array', { slot: slot.id })
    const elements = elementsOf.get(slot.id)!
    const extra = extraOf.get(slot.id)!
    if (slot.kind === 'artwork') {
      if (slot.screen) error('Artwork slot must not name a screen', { slot: slot.id })
      if (slot.pair) error('Artwork slot must not name a pair', { slot: slot.id })
      if (slot.pairPrev) error('Artwork slot must not name a pairPrev', { slot: slot.id })
      if (extra.length) error('Artwork slot must not name extra mosaic screens', { slot: slot.id })
    } else if (!slot.screen) error('Slot needs a screen', { slot: slot.id })
    const layout = slotLayouts.get(slot.id)!
    if (slot.kind === 'artwork' && layout.id === 'mosaic')
      error('mosaic needs a screen slot', { slot: slot.id })
    // A deviceless layout draws no device and no artwork placement at all (render/scene.ts), so
    // neither a missing screen frame nor a missing artwork is a problem there — only a slot still
    // carrying a screenshot nobody will ever see is.
    if (slot.kind !== 'artwork' && layout.deviceless)
      issues.push({
        level: 'warn',
        message: 'Quellbild wird nicht gezeichnet, Slot-Art artwork verwenden',
        slot: slot.id,
      })
    const position = positionOf(set, slot)
    if (!slot.artwork && !layout.deviceless && position.placements.some((p) => p.source === 'artwork'))
      error(`Arrangement ${position.id} needs an artwork, but the slot names none`, { slot: slot.id })
    // An offset the tile never draws is harmless — the layout may change back — so it only warns,
    // like `list` on a layout without one. Only the slot's own override is judged here: a set-wide
    // offset is meant for the tiles that do draw the part.
    const drawsDevice =
      !layout.deviceless &&
      (slot.kind !== 'artwork' || position.placements.some((p) => p.source === 'artwork'))
    if (slot.overrides.deviceOffset !== undefined && !drawsDevice)
      issues.push({
        level: 'warn',
        message: 'deviceOffset set but this tile draws no device; unused',
        slot: slot.id,
      })
    if (slot.overrides.textOffset !== undefined && !layout.text)
      issues.push({
        level: 'warn',
        message: 'textOffset set but this layout has no text; unused',
        slot: slot.id,
      })
    if (slot.note?.trim())
      issues.push({ level: 'warn', message: `Open feedback: ${slot.note.trim()}`, slot: slot.id })
    if (slot.role !== undefined && !TILE_ROLES.includes(slot.role))
      error(`Unknown role "${slot.role}"`, { slot: slot.id })

    // A mosaic tile draws cell 0 from `screen` and one cell per `extra` — the count is fixed at
    // 4–6 total, so 3–5 named extras. Naming any on another layout does nothing (the layout may
    // change back later, so it is a warning, not an error); naming one twice would draw the same
    // cell image in two cells.
    const extraCount = extra.length
    if (extraCount > 0) {
      if (layout.id !== 'mosaic')
        issues.push({
          level: 'warn',
          message: `Layout "${layout.id}" never draws extra mosaic screens; only "mosaic" does`,
          slot: slot.id,
        })
      const extraSeen = new Set<string>()
      for (const name of extra) {
        if (extraSeen.has(name)) error(`Duplicate mosaic screen "${name}" in extra`, { slot: slot.id })
        extraSeen.add(name)
        if (name === slot.screen) error(`extra names the slot's own screen "${name}"`, { slot: slot.id })
      }
    }
    if (
      slot.kind !== 'artwork' &&
      layout.id === 'mosaic' &&
      (extraCount < MOSAIC_MIN_EXTRA || extraCount > MOSAIC_MAX_EXTRA)
    )
      error(
        `Mosaic layout needs ${MOSAIC_MIN_EXTRA}–${MOSAIC_MAX_EXTRA} extra screens (4–6 cells total), has ${extraCount}`,
        { slot: slot.id },
      )

    const effects = elements.filter(isSlotEffect)
    if (effects.length) {
      if (slot.kind === 'artwork')
        error('An effect needs a screen slot; an artwork slot has no screenshot', { slot: slot.id })
      else if (layout.deviceless || layout.id === 'mosaic')
        issues.push({
          level: 'warn',
          message: `Layout "${layout.id}" draws no device screen; effects unused`,
          slot: slot.id,
        })
      else if (!position.placements.some((p) => p.source === 'self' && !p.frameless))
        issues.push({
          level: 'warn',
          message: `Arrangement ${position.id} frames no own screen; effects unused`,
          slot: slot.id,
        })
    }

    const marks = elements.filter(isSlotMark)
    if (marks.some((el) => markTargets(el).some((t) => t && onScreen(t)))) {
      if (slot.kind === 'artwork')
        error('A mark on the screen needs a screen slot; an artwork slot has no screenshot', {
          slot: slot.id,
        })
      else if (layout.deviceless || layout.id === 'mosaic')
        issues.push({
          level: 'warn',
          message: `Layout "${layout.id}" draws no device screen; marks on the screen unused`,
          slot: slot.id,
        })
      else if (!position.placements.some((p) => p.source === 'self' && !p.frameless))
        issues.push({
          level: 'warn',
          message: `Arrangement ${position.id} frames no own screen; marks on the screen unused`,
          slot: slot.id,
        })
    }
    if (!layout.text && marks.some((el) => markTargets(el).some((t) => t?.textBlock)))
      issues.push({
        level: 'warn',
        message: `Layout "${layout.id}" has no text block; marks on it unused`,
        slot: slot.id,
      })

    const elementIds = new Set<string>()
    for (const el of elements) {
      if (isSlotMark(el)) {
        if (elementIds.has(el.id)) error(`Duplicate mark id ${el.id}`, { slot: slot.id })
        elementIds.add(el.id)
        if (['artwork', 'shape', 'chip', 'effect'].some((k) => k in el))
          error(`Element ${el.id} must be exactly one of artwork, shape, chip, effect or mark`, {
            slot: slot.id,
          })
        for (const problem of markProblems(el)) error(`Mark ${el.id}: ${problem}`, { slot: slot.id })
        continue
      }
      if (isSlotEffect(el)) {
        if (elementIds.has(el.id)) error(`Duplicate effect id ${el.id}`, { slot: slot.id })
        elementIds.add(el.id)
        if (['artwork', 'shape', 'chip'].some((k) => k in el))
          error(`Element ${el.id} must be exactly one of artwork, shape, chip or effect`, { slot: slot.id })
        for (const problem of effectProblems(el)) error(`Effect ${el.id}: ${problem}`, { slot: slot.id })
        continue
      }
      const kind = isSlotShape(el) ? 'shape' : isSlotChip(el) ? 'chip' : 'sticker'
      const label = kind === 'shape' ? 'Shape' : kind === 'chip' ? 'Chip' : 'Sticker'
      if (elementIds.has(el.id)) error(`Duplicate ${kind} id ${el.id}`, { slot: slot.id })
      elementIds.add(el.id)
      const hasArtwork = 'artwork' in el && el.artwork !== undefined
      const hasShape = 'shape' in el && el.shape !== undefined
      const hasChip = 'chip' in el && el.chip !== undefined
      if ([hasArtwork, hasShape, hasChip].filter(Boolean).length !== 1)
        error(`Element ${el.id} must be exactly one of artwork, shape or chip`, { slot: slot.id })
      if (![el.x, el.y, el.width, el.rotate ?? 0].every(Number.isFinite))
        error(`${label} ${el.id} has a non-finite position, size or rotation`, { slot: slot.id })
      else if (el.width <= 0) error(`${label} ${el.id} has width <= 0`, { slot: slot.id })
      if (isSlotShape(el)) {
        if (!HEX_COLOR.test(el.color))
          error(`Shape ${el.id} has an invalid color "${el.color}"`, { slot: slot.id })
        if (!SHAPE_KINDS.includes(el.shape))
          error(`Shape ${el.id} has an unknown shape "${el.shape}"`, { slot: slot.id })
        if (el.stroke !== undefined) {
          if (el.shape !== 'ring') error(`Shape ${el.id} has stroke set but is not a ring`, { slot: slot.id })
          else if (el.stroke < RING_STROKE_RANGE.min || el.stroke > RING_STROKE_RANGE.max)
            error(
              `Shape ${el.id} has stroke ${el.stroke} outside the valid range ${RING_STROKE_RANGE.min}–${RING_STROKE_RANGE.max}`,
              { slot: slot.id },
            )
        }
        if (el.seed !== undefined) {
          if (el.shape !== 'blob') error(`Shape ${el.id} has seed set but is not a blob`, { slot: slot.id })
          else if (!Number.isInteger(el.seed))
            error(`Shape ${el.id} has a non-integer seed`, { slot: slot.id })
        }
      }
      if (isSlotChip(el)) {
        if (el.color !== undefined && !HEX_COLOR.test(el.color))
          error(`Chip ${el.id} has an invalid color "${el.color}"`, { slot: slot.id })
        if (el.textColor !== undefined && !HEX_COLOR.test(el.textColor))
          error(`Chip ${el.id} has an invalid textColor "${el.textColor}"`, { slot: slot.id })
        if (
          el.size !== undefined &&
          (!Number.isFinite(el.size) || el.size <= CHIP_SIZE_RANGE.min || el.size > CHIP_SIZE_RANGE.max)
        )
          error(
            `Chip ${el.id} has size ${el.size} outside the valid range (${CHIP_SIZE_RANGE.min}, ${CHIP_SIZE_RANGE.max}]`,
            { slot: slot.id },
          )
      }
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
      // same wording — so two stickers sharing one file never repeat the message either. A shape
      // or a chip has no image at all: neither ever reaches this check.
      for (const el of elementsOf.get(slot.id)!.filter(isSlotSticker)) {
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
      // A position only ever comes from the real screen: a node that is missing, ambiguous or
      // has no capture behind it fails here instead of being drawn somewhere guessed.
      const nodeEffects = elementsOf
        .get(slot.id)!
        .filter(isSlotEffect)
        .filter((el) => isNodeTarget(el.node) && el.rect === undefined)
      const nodeMarks = elementsOf
        .get(slot.id)!
        .filter(isSlotMark)
        .filter((el) => markNodes(el).length)
      if ((nodeEffects.length || nodeMarks.length) && slot.kind !== 'artwork' && slot.screen) {
        const file = nodes(locale.id, slot.screen)
        const problem = file ? nodesFileProblem(file) : null
        if (!file)
          error(`Nodes file missing: ${nodesPath(set, locale.id, slot.screen)}`, {
            slot: slot.id,
            locale: locale.id,
          })
        else if (problem)
          error(`Nodes file ${nodesPath(set, locale.id, slot.screen)} ${problem}`, {
            slot: slot.id,
            locale: locale.id,
          })
        else
          for (const [label, el, names] of [
            ...nodeEffects.map((el) => ['Effect', el, [el.node!]] as const),
            ...nodeMarks.map((el) => ['Mark', el, markNodes(el)] as const),
          ])
            for (const name of names) {
              const resolved = resolveNode(file, name)
              if ('error' in resolved)
                error(`${label} ${el.id}: ${resolved.error}`, { slot: slot.id, locale: locale.id })
            }
      }
      // An artwork slot may be a pure visual with no copy at all; a store 'screen' slot always needs
      // one. A studio picture may be the screen alone.
      if (slot.kind !== 'artwork' && !studio && !copy[slot.id]?.headline?.trim())
        error('Headline missing', { slot: slot.id, locale: locale.id })
      if (copy[slot.id]?.eyebrow && !eyebrowFits(locale.id, slot.id))
        error('Eyebrow does not fit on one line', { slot: slot.id, locale: locale.id })

      const rawList = copy[slot.id]?.list
      if (rawList !== undefined && !Array.isArray(rawList))
        error('list must be an array of strings', { slot: slot.id, locale: locale.id })
      const list = Array.isArray(rawList) ? rawList : undefined
      if (slotLayouts.get(slot.id)!.id === 'feature-wall') {
        if (!list || list.length < 2 || list.length > 8)
          error(`feature-wall needs 2-8 list entries, has ${list?.length ?? 0}`, {
            slot: slot.id,
            locale: locale.id,
          })
        else {
          for (const entry of list) {
            if (typeof entry !== 'string')
              error('List entry must be a string', { slot: slot.id, locale: locale.id })
            else if (!entry.trim()) error('List entry is empty', { slot: slot.id, locale: locale.id })
            else if (/[\r\n]/.test(entry))
              error('List entry must be a single line', { slot: slot.id, locale: locale.id })
          }
          if (!listFits(locale.id, slot.id))
            error('List does not fit its band', { slot: slot.id, locale: locale.id })
        }
      } else if (list?.length) {
        issues.push({
          level: 'warn',
          message: 'List set but the layout is not feature-wall; unused',
          slot: slot.id,
          locale: locale.id,
        })
      }

      // A chip is always meant to carry text — unlike an eyebrow, there is no "same as absent"
      // reading of a blank one. It is also always one line: the pill never wraps.
      const rawChips = copy[slot.id]?.chips
      if (
        rawChips !== undefined &&
        (typeof rawChips !== 'object' || rawChips === null || Array.isArray(rawChips))
      )
        error('chips must be an object', { slot: slot.id, locale: locale.id })
      const chips = rawChips && typeof rawChips === 'object' && !Array.isArray(rawChips) ? rawChips : {}
      for (const el of elementsOf.get(slot.id)!.filter(hasChipText)) {
        const kind = isSlotChip(el) ? 'Chip' : 'Label'
        const text = chips[el.id]
        if (!text?.trim()) error(`${kind} text missing: ${el.id}`, { slot: slot.id, locale: locale.id })
        else if (/[\r\n]/.test(text))
          error(`${kind} text must be one line: ${el.id}`, { slot: slot.id, locale: locale.id })
      }
      const chipIds = new Set(
        elementsOf
          .get(slot.id)!
          .filter(hasChipText)
          .map((c) => c.id),
      )
      for (const chipId of Object.keys(chips)) {
        if (!chipIds.has(chipId))
          issues.push({
            level: 'warn',
            message: `Copy for unknown chip "${chipId}"`,
            slot: slot.id,
            locale: locale.id,
          })
      }
    }
    for (const slotId of Object.keys(copy)) {
      if (!seen.has(slotId))
        issues.push({ level: 'warn', message: 'Copy for unknown slot', slot: slotId, locale: locale.id })
    }
  }

  for (const slot of set.slots) {
    if (slot.kind !== 'artwork' || elementsOf.get(slot.id)!.length) continue
    const hasCopy = set.locales.some((l) => {
      const c = copies[l.id]?.[slot.id]
      return !!(c?.headline?.trim() || c?.subhead?.trim() || c?.eyebrow?.trim() || c?.list?.length)
    })
    if (!hasCopy)
      issues.push({ level: 'warn', message: 'Artwork slot has neither stickers nor any copy', slot: slot.id })
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

  const tileAspects = (set.targets.length ? set.targets : [{ sizeId: EXPORT_SIZES[0].id }]).map((t) => {
    const size = EXPORT_SIZES.find((s) => s.id === t.sizeId) ?? EXPORT_SIZES[0]
    return size.w / size.h
  })

  // Contrast. Colours are locale-independent (overrides never vary by locale), so each slot is
  // resolved once — exactly as the renderer resolves it, including an active "contrast tile" —
  // but subhead/eyebrow/highlight checks only fire when some locale actually carries that text.
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
    // last, over everything. The sticker's box is only ever approximate: `elementAspect` gives the
    // real aspect ratio when the check has loaded the image, otherwise the sticker is treated as a
    // square. The text block is where the renderer puts it — measured when `textBlocks` can,
    // `approxTextBlock` otherwise — `textOffset` and `feature-wall`'s centring included. A shape
    // is deco, not content — it may sit under the headline on purpose (the big background circle
    // behind the feature graphic's stickers is exactly this), so it never warns. A chip's real box
    // needs its shrunk font size, which this check has no canvas to measure — it is exempt too,
    // rather than warn from a guess that could easily be wrong either way.
    const layout = slotLayouts.get(slot.id)!
    const frontStickers = elementsOf
      .get(slot.id)!
      .filter(isSlotSticker)
      .filter((el) => (el.layer ?? 'front') === 'front')
    const offset = offsetProblem(effective.textOffset) ? undefined : effective.textOffset
    const moved = !!offset && (offset.dx !== 0 || offset.dy !== 0)
    if (layout.text && (frontStickers.length || moved)) {
      const blocks: TextBlockProbe[] = textBlocks
        ? set.locales.flatMap((l) => textBlocks(l.id, slot.id))
        : tileAspects.map((tileAspect) => ({ tileAspect, box: approxTextBlock(layout, offset) }))
      for (const el of frontStickers) {
        const aspect = elementAspect(set.locales[0]?.id ?? '', el.artwork)
        if (
          blocks.some(({ tileAspect, box }) =>
            boxesOverlap(stickerBox(el, layout.span, aspect, tileAspect), box),
          )
        )
          issues.push({
            level: 'warn',
            message: `Sticker "${el.id}" may cover the headline (box approximated from width${aspect ? " and the image's aspect ratio" : ' as a square, since the image size is not known here'})`,
            slot: slot.id,
          })
      }
      // Only a move can put the copy off the tile; the layout alone keeps its band inside.
      const off = moved ? blocks.filter(({ box }) => !within(box, TILE)) : []
      if (off.length) {
        const how = off.some(({ box }) => !boxesOverlap(box, TILE)) ? 'entirely' : 'partly'
        issues.push({
          level: 'warn',
          message: `textOffset pushes the headline ${how} off the tile${textBlocks ? '' : " (text box approximated from the layout's text band)"}`,
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

    // 'label' falls back to 'plain' with no highlights to draw the box in — same rule the
    // renderer applies (`layoutText` in `render/text.ts`), so `forge check` and the export agree.
    const labelStyle = effective.subheadStyle === 'label' && effective.highlights.length > 0
    if (effective.subheadStyle === 'label' && effective.highlights.length === 0)
      issues.push({
        level: 'warn',
        message: `subheadStyle "label" has no highlights to draw the box in; falls back to "plain"`,
        slot: slot.id,
      })

    const hasSubhead = set.locales.some((l) => copies[l.id]?.[slot.id]?.subhead?.trim())
    if (hasSubhead) {
      if (labelStyle) {
        // The label subhead is drawn fully opaque in textColor on the label box, not against
        // the background.
        push(contrastIssue('Subhead', contrastRatio(effective.textColor, effective.highlights[0]), 'label'))
      } else {
        const ratio = contrastAgainstBackground(effective.textColor, effective.background, SUBHEAD_ALPHA)
        push(contrastIssue('Subhead', ratio, 'background'))
      }
    }

    const hasEyebrow = set.locales.some((l) => copies[l.id]?.[slot.id]?.eyebrow?.trim())
    if (hasEyebrow) {
      const eyebrowColor = effective.eyebrowColor ?? effective.textColor
      push(
        contrastIssue('Eyebrow', contrastAgainstBackground(eyebrowColor, effective.background), 'background'),
      )
    }

    // Every span a `*starred*` headline or feature-wall list entry actually uses, in any locale —
    // mirrors how drawLine in render/text.ts picks `highlights[span % highlights.length]`.
    const spans = new Set<number>()
    for (const locale of set.locales) {
      for (const word of parseMarkup(copies[locale.id]?.[slot.id]?.headline ?? ''))
        if (word.span >= 0) spans.add(word.span)
      const list = copies[locale.id]?.[slot.id]?.list
      if (Array.isArray(list))
        for (const entry of list)
          if (typeof entry === 'string')
            for (const word of parseMarkup(entry)) if (word.span >= 0) spans.add(word.span)
    }
    const highlightColors = new Set<string>()
    for (const span of spans) highlightColors.add(effective.highlights[span % effective.highlights.length])
    for (const color of highlightColors)
      push(contrastIssue('Headline', contrastRatio(effective.textColor, color), 'highlight'))
  }

  return issues
}
