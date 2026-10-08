import type { MarkSide, SceneElementLayer, ScreenOverrides, ShapeKind, Settings } from '../types'
import type { Background } from '../types'

export type ProjectTarget = { id: string; sizeId: string; deviceId: string; out: string }
/** `store` maps a target id to the store's own locale code; a studio set may leave it out and
 *  writes under the locale id instead. */
export type ProjectLocale = { id: string; store?: Record<string, string> }
/** `store` (the default when absent) feeds an app store: every locale needs a store code, the
 *  upload needs an approval stamp. `studio` makes pictures for a website or a post: one language is
 *  enough, no stamp, an empty headline is fine, and a target may write WebP. */
export type SetPurpose = 'store' | 'studio'
export const isStudioSet = (set: Pick<ProjectSet, 'purpose'>) => set.purpose === 'studio'
export type SlotKind = 'screen' | 'artwork'

/** A slot's place in the deck's sequence — which job its headline has to do. Feeds the "Ideas"
 *  menu's formula picker (`presets/copyIdeas.ts`); drawn nowhere, so it is not part of the
 *  approval hash (`project/hash.ts`, like `note`). */
export type TileRole = 'hero' | 'difference' | 'feature' | 'proof' | 'closer'
export const TILE_ROLES: TileRole[] = ['hero', 'difference', 'feature', 'proof', 'closer']

/** Fields every free-standing slot element shares — sticker or shape — not a setting, not an
 *  override, just extra material the slot carries. `x`/`y` are the element's centre, `x` a
 *  fraction of the composition width (tile width × the layout's span), `y` a fraction of the
 *  tile height — the convention every layout already uses. `width` is a fraction of the tile
 *  width. `rotate` is degrees, clockwise positive, like a placement's `rotate`. */
type SlotElementBase = {
  id: string
  x: number
  y: number
  width: number
  /** default 0 */
  rotate?: number
  /** default 'front' for a sticker, 'behind' for a shape (see the GUI's `SHAPE_DEFAULTS`) */
  layer?: SceneElementLayer
}

/**
 * A free-standing image (a sticker) on a slot. Resolved through the same `artworkSources`
 * template as a slot's own `artwork`; there is no second path mechanism. Height follows the
 * image's own aspect ratio.
 */
export type SlotSticker = SlotElementBase & {
  /** file name (no directory, no extension), resolved exactly like a slot's `artwork` */
  artwork: string
  /** default false */
  shadow?: boolean
}

/** A filled deco shape (e.g. a circle behind the stickers). No image, no shadow; `width` is the
 *  shape's own extent (outer diameter) as a fraction of the tile width. */
export type SlotShape = SlotElementBase & {
  shape: ShapeKind
  /** #rgb, #rrggbb or #rrggbbaa */
  color: string
  /** `shape: 'ring'` only: stroke width as a fraction of the outer diameter, 0.02–0.5. Default
   *  0.12; `validateProject` rejects it on any other shape and outside that range. */
  stroke?: number
  /** `shape: 'blob'` only: seeds the deterministic PRNG that shapes it. Default 1;
   *  `validateProject` rejects it on any other shape and requires an integer. */
  seed?: number
}

/**
 * A floating pill with a short line of text, one per locale — a real number or a short claim
 * ("+312 € gespart"), free-standing like a sticker but drawn, not an image. `chip: true` is a
 * plain boolean discriminator, unlike a shape's own `shape` kind, because a chip has no further
 * variants today. `width` is the pill's *maximum* width (a fraction of the tile width, like every
 * other element) — the pill itself hugs the text, up to that ceiling.
 */
export type SlotChip = SlotElementBase & {
  chip: true
  /** #rgb, #rrggbb or #rrggbbaa; default: `highlights[0]` of the slot's effective settings, or
   *  '#ffffff' with none — resolved by the renderer (it knows the effective settings, this type
   *  does not), never written here. */
  color?: string
  /** default: the slot's effective `textColor` */
  textColor?: string
  /** font size, as a fraction of the tile height; default `DEFAULT_CHIP_SIZE` (`project/bridge.ts`) */
  size?: number
  /** default false */
  shadow?: boolean
}

/** A part of the slot's own screenshot, as fractions of its width (`x`, `w`) and height (`y`, `h`). */
export type EffectRect = { x: number; y: number; w: number; h: number }

/**
 * An effect works on the slot's own screenshot inside its device, not on the composition, so it
 * has no position, size, turn or layer of its own. It targets exactly one of `rect` (by hand) or
 * `node` (one name or several, looked up in the capture's `<screen>.nodes.json`: first `tag`, then `text`, then `desc`,
 * each exact; no match or several on one step is an error, never a guess).
 */
type SlotEffectBase = {
  id: string
  /** the device it works on in a duo or trio: 'next' (the pair) or 'prev'; default 'self' */
  device?: 'self' | 'next' | 'prev'
  rect?: EffectRect
  /** several names target the rectangle around all their nodes */
  node?: string | string[]
  /** margin around the target on every side, as a fraction of the screenshot width; default 0 */
  pad?: number
}

/** Lifts the target out of the device, slightly enlarged and with a shadow; the rest recedes. */
export type SlotLift = SlotEffectBase & {
  effect: 'lift'
  /** default 1.08 */
  scale?: number
  /** how far the rest of the screen darkens, 0–0.9; default 0.35 */
  dim?: number
  /** how far the rest of the screen loses its colour, 0–1; default 0 */
  gray?: number
  /** degrees, clockwise, -45–45: `rect` is the target before turning (a tilted card); default 0 */
  angle?: number
  /** leave the background around the target behind (flood-filled from the box edge); default false */
  cutout?: boolean
  /** lifts with the same group are raised as one stack, scaled together (overlapping cards) */
  group?: string
  /** in a right-to-left locale target the mirrored rect (x becomes 1 - x - w); default false */
  mirrorRtl?: boolean
}

export type LoupePlace = 'over' | 'above' | 'below' | 'left' | 'right'

/** A round magnifier over or beside the target. */
export type SlotLoupe = SlotEffectBase & {
  effect: 'loupe'
  /** default 2 */
  zoom?: number
  /** diameter as a fraction of the tile width; default: the magnified target, within 0.18–0.45 */
  size?: number
  /** default 'over' */
  place?: LoupePlace
  /** rim colour, hex; default '#ffffff' */
  ring?: string
}

/** Blurs everything on the screen except the target. */
export type SlotFocus = SlotEffectBase & {
  effect: 'focus'
  /** blur radius as a fraction of the screenshot width; default 0.012 */
  strength?: number
  /** darkens the blurred rest, 0–0.9; default 0 */
  dim?: number
}

export type RedactStyle = 'pixelate' | 'blur'

/** Makes the target unreadable for good: whatever samples the screen afterwards sees it redacted. */
export type SlotRedact = SlotEffectBase & {
  effect: 'redact'
  /** default 'pixelate' */
  style?: RedactStyle
  /** block size (pixelate) or blur radius (blur), fraction of the screenshot width; default 0.03 */
  strength?: number
}

export type SlotEffect = SlotLift | SlotLoupe | SlotFocus | SlotRedact
export type EffectKind = SlotEffect['effect']
export const EFFECT_KINDS: EffectKind[] = ['lift', 'loupe', 'focus', 'redact']

/**
 * Where a mark points, exactly one of: `rect` or `node` (a part of the slot's own screenshot,
 * resolved like an effect's target, `pad` around it), `at` (a box on the tile: `x`/`w` fractions
 * of the composition width, `y`/`h` of the tile height; without `w`/`h` a point), or `textBlock`
 * (the tile's headline block). `side` picks the point beside the target a step or a label sits at,
 * or the edge an arrow starts or ends on; absent, an arrow takes the edge facing its other end.
 */
export type SlotMarkTarget = {
  rect?: EffectRect
  node?: string | string[]
  pad?: number
  at?: { x: number; y: number; w?: number; h?: number }
  textBlock?: true
  side?: MarkSide
}

/** A numbered circle. */
export type SlotStep = SlotMarkTarget & {
  id: string
  mark: 'step'
  /** a number, or up to three characters */
  n: number | string
  /** diameter, fraction of the tile's shorter side; default 0.062 */
  size?: number
  /** default: the set's accent (`accentBar`, else `eyebrowColor`), else a strong red */
  color?: string
  /** default: white or near-black, whichever reads better on `color` */
  textColor?: string
}

/** A curved arrow from one target to another. */
export type SlotArrow = {
  id: string
  mark: 'arrow'
  from: SlotMarkTarget
  to: SlotMarkTarget
  /** bend, -1..1, as a fraction of the length; default 0.25 */
  curve?: number
  /** line width, fraction of the tile's shorter side; default 0.009 */
  stroke?: number
  color?: string
}

/** A highlighter stroke over the target. */
export type SlotHighlight = SlotMarkTarget & {
  id: string
  mark: 'highlight'
  /** default: the set's first highlight colour */
  color?: string
  /** 0.1–1; default 0.85 */
  opacity?: number
}

/** A rounded frame around the target. */
export type SlotOutline = SlotMarkTarget & {
  id: string
  mark: 'outline'
  color?: string
  /** line width, fraction of the tile's shorter side; default 0.008 */
  stroke?: number
}

/** A short caption in a pill beside the target; its text is copy, keyed by the element id under
 *  `chips` like a chip's. */
export type SlotLabel = SlotMarkTarget & {
  id: string
  mark: 'label'
  /** font size, fraction of the tile height; default 0.024 */
  size?: number
  color?: string
  textColor?: string
}

export type SlotMark = SlotStep | SlotArrow | SlotHighlight | SlotOutline | SlotLabel
export type MarkKind = SlotMark['mark']
export const MARK_KINDS: MarkKind[] = ['step', 'arrow', 'highlight', 'outline', 'label']

/** Exactly one of `artwork` (a sticker), `shape` (a deco shape), `chip` (a text pill), `effect` or
 *  `mark` — never more than one, never none; `validateProject` enforces it. */
export type SlotElement = SlotSticker | SlotShape | SlotChip | SlotEffect | SlotMark

/** A placed element: everything but an effect or a mark, which have no place of their own. */
export type SlotPlaced = SlotSticker | SlotShape | SlotChip

export const isSlotShape = (el: SlotElement): el is SlotShape => 'shape' in el
export const isSlotChip = (el: SlotElement): el is SlotChip => 'chip' in el
export const isSlotSticker = (el: SlotElement): el is SlotSticker => 'artwork' in el
export const isSlotEffect = (el: SlotElement): el is SlotEffect => 'effect' in el
export const isSlotMark = (el: SlotElement): el is SlotMark => 'mark' in el
export const isSlotPlaced = (el: SlotElement): el is SlotPlaced => !('effect' in el) && !('mark' in el)
/** Elements whose text lives in the copy's `chips`, keyed by their id. */
export const hasChipText = (el: SlotElement): el is SlotChip | SlotLabel =>
  isSlotChip(el) || (isSlotMark(el) && el.mark === 'label')

/** Every target of a mark: one, or an arrow's two ends. */
export const markTargets = (el: SlotMark): SlotMarkTarget[] => (el.mark === 'arrow' ? [el.from, el.to] : [el])

/** Whether an element is placed through a capture's nodes file. */
export const usesNodes = (el: SlotElement): boolean =>
  isSlotEffect(el)
    ? el.node !== undefined
    : isSlotMark(el) && markTargets(el).some((t) => t && t.node !== undefined)

/** What a capture writes next to its screenshot: every node with its bounds in the capture's pixels. */
export type CaptureNode = {
  tag?: string
  text?: string
  desc?: string
  /** [left, top, right, bottom] */
  bounds: [number, number, number, number]
}
export type NodesFile = { width: number; height: number; nodes: CaptureNode[] }
export type ProjectSlot = {
  id: string
  kind: SlotKind
  /**
   * The source screenshot this slot draws. Required for `kind: 'screen'`; a `kind: 'artwork'`
   * slot has no source screenshot at all and must leave this, `pair` and `pairPrev` absent —
   * validation rejects any of the three on an artwork slot.
   */
  screen?: string
  overrides: ScreenOverrides
  /**
   * The screen a multi-device arrangement draws as its `next` frame, instead of the next slot's.
   * Lets a duo show a screen that is not the neighbour — and need not be in the set at all.
   */
  pair?: string
  /**
   * The same for the `prev` frame. With both named, a trio arrangement shows three chosen
   * screens instead of borrowing its neighbours from the strip.
   */
  pairPrev?: string
  /**
   * File name (no directory, no extension) of the frameless image an arrangement with an
   * `artwork` placement draws next to the screen. Unrelated to `kind: 'artwork'`.
   */
  artwork?: string
  /** free-standing images (stickers) drawn on this slot; absent or empty means none. The GUI
   *  must never write an empty array — no stickers means the key is absent. */
  elements?: SlotElement[]
  /**
   * Extra source screens for the mosaic layout's cells 2..n (cell 1 is `screen`), resolved
   * through `sources` exactly like `screen`/`pair`/`pairPrev`. A slot whose effective layout is
   * `mosaic` needs 3–5 of them (4–6 cells total); on any other layout they are simply unused
   * (`validateProject` warns). The GUI must never write an empty array — no extra cells means the
   * key is absent, same convention as `elements`.
   */
  extra?: string[]
  /** open feedback for whoever regenerates this screenshot; never part of the approval hash */
  note?: string
  /** this slot's place in the deck (hero, differentiator, ...); absent = none picked. Changes no
   *  pixel, so it never invalidates an approval — unlike a note, it is an ordinary edit and travels
   *  through undo/redo (`store.ts`'s `setSlotRole`). */
  role?: TileRole
}
export type Approval = { hash: string; at: string }
export type ProjectSettings = Omit<Settings, 'sizeId' | 'deviceId'>

export type ProjectSet = {
  version: 1
  id: string
  /** absent = 'store' — and absent it stays, so a store set keeps the approval hash it had */
  purpose?: SetPurpose
  targets: ProjectTarget[]
  locales: ProjectLocale[]
  /** template with {locale} and {screen} */
  sources: string
  /** template with a mandatory {artwork} and an optional {locale}; see DEFAULT_ARTWORK_SOURCES */
  artworkSources?: string
  settings: Partial<ProjectSettings>
  slots: ProjectSlot[]
  approval: Approval | null
}

/** `eyebrow` absent (not empty string) means the slot names none for that locale. `list` absent
 *  (not an empty array) means the same for `feature-wall`'s rows — the GUI must never write an
 *  empty array, or a project that never had one would hash differently forever. `chips` keys by
 *  the slot's own chip element ids; a key with no matching chip is a warning, a chip with no key
 *  (or a blank one) is an error — a chip is always meant to carry text. */
export type SlotCopy = {
  headline: string
  subhead: string
  eyebrow?: string
  list?: string[]
  chips?: Record<string, string>
}
export type LocaleCopy = Record<string, SlotCopy>
export type ProjectCopies = Record<string, LocaleCopy>
export type Project = { set: ProjectSet; copies: ProjectCopies }

/** Every source screen a slot draws: its own, any explicitly named partner, and the mosaic
 *  layout's extra cells. A hand-edited project file may give `extra` the wrong JSON shape (a
 *  string instead of an array); `validateProject` reports that separately, but this must still
 *  not throw spreading it, since it runs before that check gets a chance to. */
export const slotScreens = (slot: ProjectSlot): string[] =>
  [slot.screen, slot.pair, slot.pairPrev, ...(Array.isArray(slot.extra) ? slot.extra : [])].filter(
    (s): s is string => !!s,
  )

/** Every background a set can draw: its own, its contrast pair's, and each slot's overrides. */
export function setBackgrounds(set: ProjectSet): Background[] {
  const all = [set.settings.background, set.settings.altColors?.background]
  for (const slot of set.slots) all.push(slot.overrides?.background, slot.overrides?.altColors?.background)
  return all.filter((bg): bg is Background => !!bg && typeof bg === 'object')
}

/** The background image files a set names, each once, in the order they first appear. */
export const backgroundImageSrcs = (set: ProjectSet): string[] => [
  ...new Set(
    setBackgrounds(set)
      .map((bg) => bg.image?.src)
      .filter((src): src is string => typeof src === 'string' && !!src),
  ),
]
