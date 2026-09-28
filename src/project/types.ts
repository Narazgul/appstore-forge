import type { SceneElementLayer, ScreenOverrides, Settings } from '../types'

export type ProjectTarget = { id: string; sizeId: string; deviceId: string; out: string }
export type ProjectLocale = { id: string; store: Record<string, string> }
export type SlotKind = 'screen' | 'artwork'

/**
 * A free-standing image (a sticker) on a slot — not a setting, not an override, just extra
 * material the slot carries. Resolved through the same `artworkSources` template as a slot's
 * own `artwork`; there is no second path mechanism. `x`/`y` are the sticker's centre, `x` a
 * fraction of the composition width (tile width × the layout's span), `y` a fraction of the tile
 * height — the convention every layout already uses. `width` is a fraction of the tile width;
 * height follows the image's own aspect ratio. `rotate` is degrees, clockwise positive, like a
 * placement's `rotate`.
 */
export type SlotElement = {
  id: string
  /** file name (no directory, no extension), resolved exactly like a slot's `artwork` */
  artwork: string
  x: number
  y: number
  width: number
  /** default 0 */
  rotate?: number
  /** default 'front' */
  layer?: SceneElementLayer
  /** default false */
  shadow?: boolean
}
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

/** `eyebrow` absent (not empty string) means the slot names none for that locale. */
export type SlotCopy = { headline: string; subhead: string; eyebrow?: string }
export type LocaleCopy = Record<string, SlotCopy>
export type ProjectCopies = Record<string, LocaleCopy>
export type Project = { set: ProjectSet; copies: ProjectCopies }

/** Every source screen a slot draws: its own plus any explicitly named partner. */
export const slotScreens = (slot: ProjectSlot): string[] =>
  [slot.screen, slot.pair, slot.pairPrev].filter((s): s is string => !!s)
