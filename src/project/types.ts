import type { SceneElementLayer, ScreenOverrides, ShapeKind, Settings } from '../types'

export type ProjectTarget = { id: string; sizeId: string; deviceId: string; out: string }
export type ProjectLocale = { id: string; store: Record<string, string> }
export type SlotKind = 'screen' | 'artwork'

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

/** Exactly one of `artwork` (a sticker), `shape` (a deco shape) or `chip` (a text pill) — never
 *  more than one, never none; `validateProject` enforces it. */
export type SlotElement = SlotSticker | SlotShape | SlotChip

export const isSlotShape = (el: SlotElement): el is SlotShape => 'shape' in el
export const isSlotChip = (el: SlotElement): el is SlotChip => 'chip' in el
export const isSlotSticker = (el: SlotElement): el is SlotSticker => 'artwork' in el
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
}
export type Approval = { hash: string; by: string; at: string }
export type ProjectSettings = Omit<Settings, 'sizeId' | 'deviceId'>

export type ProjectSet = {
  version: 1
  id: string
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
