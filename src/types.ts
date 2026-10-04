/**
 * A photo or painting under everything else, cover-fitted to the composition. `src` is a path from
 * the repo root, like a set's `sources`; the colour or gradient it sits on shows while the image
 * loads, so it should match the image's overall tone; `forge check` measures the image itself
 * behind the text block.
 */
export type BackgroundImage = {
  src: string
  /** the point of the image (fractions of its width / height) kept as close to the centre as the
   *  crop allows; default 0.5 / 0.5 */
  focusX?: number
  focusY?: number
  /** 1 (default) fills the composition exactly; above it crops further in around the focus */
  zoom?: number
  /** blur radius as a fraction of the tile width; default 0 */
  blur?: number
  /** multiplies every channel, like CSS brightness(); default 1 */
  brightness?: number
}

export type GrainFinish = { kind: 'grain'; amount?: number; size?: number; mono?: boolean; seed?: number }
export type MotionFinish = { kind: 'motion'; length?: number; angle?: number }
export type HalftoneFinish = { kind: 'halftone'; cell?: number; angle?: number; paper?: string }
export type NewsprintFinish = {
  kind: 'newsprint'
  cell?: number
  angle?: number
  ink?: string
  paper?: string
  seed?: number
}
export type DitherFinish = { kind: 'dither'; pixel?: number; dark?: string; light?: string }
export type RisoFinish = {
  kind: 'riso'
  inks?: [string, string]
  paper?: string
  offset?: number
  grain?: number
  seed?: number
}
export type DuotoneFinish = { kind: 'duotone'; dark?: string; light?: string }
export type ReededFinish = {
  kind: 'reeded'
  rib?: number
  strength?: number
  direction?: 'vertical' | 'horizontal'
}

/** A surface treatment of the background alone — never of a device, the copy or an element. Every
 *  field is optional (defaults in `render/finishes.ts`); noise comes from `seed` only, so a finish
 *  draws the same pixels on every run. */
export type Finish =
  | GrainFinish
  | MotionFinish
  | HalftoneFinish
  | NewsprintFinish
  | DitherFinish
  | RisoFinish
  | DuotoneFinish
  | ReededFinish
export type FinishKind = Finish['kind']

/** `image` and `finish` are optional on either kind; a background without them draws exactly as
 *  it did before they existed. */
type BackgroundLayers = { image?: BackgroundImage; finish?: Finish[] }

export type Background =
  | ({ kind: 'solid'; color: string } & BackgroundLayers)
  | ({ kind: 'gradient'; from: string; to: string; angle: number } & BackgroundLayers)

export type NotchKind = 'island' | 'punch' | 'none'

/** A device frame is described geometrically and drawn with canvas primitives,
 *  so there are no bitmap assets to ship or license. */
export type DeviceGroup = 'iPhone' | 'iPad' | 'Android' | 'Other'

export type DeviceSpec = {
  id: string
  label: string
  group: DeviceGroup
  /** width / height of the *screen* area */
  screenAspect: number
  /** bezel thickness, as a fraction of the outer frame width */
  bezel: number
  /** outer corner radius, as a fraction of the outer frame width */
  radius: number
  notch: NotchKind
  /** a browser window instead of a phone: the height of its title bar with the address field, as a
   *  fraction of the outer frame width; the screen sits below it */
  toolbar?: number
}

export type FrameColor = {
  id: string
  label: string
  body: string
  edge: string
}

export type PlacementSource = 'self' | 'next' | 'prev' | 'artwork'

export type Placement = {
  /** which screenshot fills this frame */
  source: PlacementSource
  /** offset from the slot centre, as fractions of canvas width / height */
  dx: number
  dy: number
  scale: number
  rotate: number
  /** draw the image alone — contain-fitted into the box, no device body, no notch */
  frameless?: boolean
}

export type Position = {
  id: string
  label: string
  /** drawn back to front */
  placements: Placement[]
}

/**
 * A pure move of one part of a composition, in the units a placement's own `dx`/`dy` use: `dx` a
 * fraction of the composition width (tile width × span), `dy` of the tile height. Applied after
 * the layout has placed the part — the device lift and the text auto-shrink never see it — so the
 * part lands exactly this far from where the layout alone would put it. No RTL mirroring, like a
 * sticker's `x`. Absent means no move; the GUI never writes `{ dx: 0, dy: 0 }`.
 */
export type Offset = { dx: number; dy: number }

/** `|dx|` and `|dy|` may not exceed this: one whole composition width / tile height — anything
 *  further is entirely off the canvas, a slip rather than a design. */
export const OFFSET_LIMIT = 1

export type SceneElementLayer = 'behind' | 'front'

/** The soft drop shadow a device frame casts, or a flat hard-edged one, or none.
 *  'soft' is the frame's original, hard-coded look — the default keeps every existing
 *  export byte-identical. */
export type DeviceShadow = 'soft' | 'hard' | 'none'

/** A shape element's silhouette. */
export type ShapeKind = 'circle' | 'ring' | 'blob'

/** Fields every free-standing slot element shares — sticker or shape — independent of any
 *  device frame. Resolved from a project's `SlotElement` (see `project/types.ts`) with every
 *  optional field defaulted, so the renderer never has to ask "or else what". */
export type SceneElementBase = {
  id: string
  /** fraction of the composition width (tile width × span); the element's centre */
  x: number
  /** fraction of the tile height; the element's centre */
  y: number
  /** fraction of the tile width; height follows the image's own aspect ratio for a sticker, or
   *  equals width for a shape (a circle's diameter) */
  width: number
  /** degrees, clockwise positive, like a placement's rotate */
  rotate: number
  layer: SceneElementLayer
}

/** A free-standing image — the original sticker. */
export type StickerElement = SceneElementBase & {
  /** key into the image registry, alongside `imageId` / `artworkId` / `pairId` */
  imageId: string
  shadow: boolean
}

/** A filled deco shape — no image, no shadow. `stroke` and `seed` are only meaningful for the
 *  shape kind that reads them (`ring`, `blob`); `drawShape` applies its own default when a kind
 *  that does use one leaves it out. */
export type ShapeElement = SceneElementBase & {
  shape: ShapeKind
  color: string
  /** ring only: stroke width as a fraction of the outer diameter. Default 0.12. */
  stroke?: number
  /** blob only: seeds the deterministic PRNG that shapes it. Default 1. */
  seed?: number
}

/**
 * A floating pill of headline-weight text — a callout with a real number, independent of any
 * device frame. `color`/`textColor` are left `undefined` when the slot names none: unlike a
 * sticker or a shape, a chip's default look depends on the settings in force, not just its own
 * fields, so `renderScene` resolves them at draw time (rules.md #2 — inheritance still resolves
 * in exactly one place, this is a fallback on top of that, not a second inheritance path).
 */
export type ChipElement = SceneElementBase & {
  text: string
  color?: string
  textColor?: string
  /** font size, as a fraction of the tile height */
  size: number
  shadow: boolean
}

/** A part of the screenshot, as fractions of its width (`x`, `w`) and height (`y`, `h`). */
export type ScreenRect = { x: number; y: number; w: number; h: number }

/** Every field resolved: `rect` is already looked up from a capture's nodes when the slot named
 *  one, `pad` (a fraction of the screenshot width) is applied by the renderer, which knows the
 *  image's pixel size. */
type EffectBase = { id: string; rect: ScreenRect; pad: number }
export type LiftEffect = EffectBase & { effect: 'lift'; scale: number; dim: number; gray: number }
export type LoupeEffect = EffectBase & {
  effect: 'loupe'
  zoom: number
  /** fraction of the tile width; undefined sizes the loupe from the magnified target */
  size?: number
  place: 'over' | 'above' | 'below' | 'left' | 'right'
  ring: string
}
export type FocusEffect = EffectBase & { effect: 'focus'; strength: number; dim: number }
export type RedactEffect = EffectBase & { effect: 'redact'; style: 'pixelate' | 'blur'; strength: number }
export type EffectElement = LiftEffect | LoupeEffect | FocusEffect | RedactEffect

export type MarkSide = 'center' | 'left' | 'right' | 'top' | 'bottom'

/** What a mark points at, resolved: a part of the slot's own screenshot (drawn wherever its device
 *  lands), a box on the tile (`x`/`w` fractions of the composition width, `y`/`h` of the tile
 *  height; zero size is a point), or the tile's text block, which only the renderer can measure. */
export type MarkTarget = (
  | { on: 'screen'; rect: ScreenRect; pad: number }
  | { on: 'tile'; x: number; y: number; w: number; h: number }
  | { on: 'text' }
) & { side?: MarkSide }

/** Colours left undefined fall back at draw time, like a chip's: they depend on the effective settings. */
export type StepMark = {
  id: string
  mark: 'step'
  at: MarkTarget
  n: string
  /** diameter, fraction of the tile's shorter side */
  size: number
  color?: string
  textColor?: string
}
export type ArrowMark = {
  id: string
  mark: 'arrow'
  from: MarkTarget
  to: MarkTarget
  /** sideways bend of the middle, as a fraction of the arrow's length; the sign picks the side */
  curve: number
  /** line width, fraction of the tile's shorter side */
  stroke: number
  color?: string
}
export type HighlightMark = { id: string; mark: 'highlight'; at: MarkTarget; opacity: number; color?: string }
export type OutlineMark = { id: string; mark: 'outline'; at: MarkTarget; stroke: number; color?: string }
export type LabelMark = {
  id: string
  mark: 'label'
  at: MarkTarget
  caption: string
  /** font size, fraction of the tile height */
  size: number
  color?: string
  textColor?: string
}
export type MarkElement = StepMark | ArrowMark | HighlightMark | OutlineMark | LabelMark

export type SceneElement = StickerElement | ShapeElement | ChipElement | EffectElement | MarkElement
/** Everything with a place of its own on the tile — every element but an effect or a mark. */
export type PlacedElement = StickerElement | ShapeElement | ChipElement

export const isShapeElement = (el: SceneElement): el is ShapeElement => 'shape' in el
export const isChipElement = (el: SceneElement): el is ChipElement => 'text' in el
export const isStickerElement = (el: SceneElement): el is StickerElement => 'imageId' in el
export const isEffectElement = (el: SceneElement): el is EffectElement => 'effect' in el
export const isMarkElement = (el: SceneElement): el is MarkElement => 'mark' in el
export const isPlacedElement = (el: SceneElement): el is PlacedElement => !('effect' in el) && !('mark' in el)
/** Whether turning an element shows — a circle or a ring looks the same at every angle, so neither
 *  the canvas (turn handle) nor the Stickers panel (Rotate slider) offers one. Scene or slot element. */
export const turnsVisibly = (el: object): boolean => !('shape' in el) || el.shape === 'blob'

export type LayoutId =
  | 'text-top'
  | 'text-bottom'
  | 'bleed'
  | 'editorial'
  | 'hero'
  | 'duo'
  | 'panorama'
  | 'panorama-duo'
  | 'centered'
  | 'banner-left'
  | 'banner-right'
  | 'text-only'
  | 'feature-wall'
  | 'mosaic'
  | 'landscape-left'
  | 'landscape-right'
  | 'landscape-center'

/**
 * A layout is one composition. Fractions are of the *tile* height for vertical values and of
 * the *composition* width (tile width × span) for horizontal ones, so a panorama can put its
 * copy on the left tile and its device across the seam.
 */
export type Layout = {
  id: LayoutId
  label: string
  /** store tiles this composition covers; a span-2 layout is sliced into two PNGs on export */
  span: 1 | 2
  /**
   * Band for the text block. `left`/`width` position the box across the composition; absent,
   * the box is the tile minus `padX` on both sides. The block is centred in the band.
   */
  text: { top: number; height: number; left?: number; width?: number } | null
  /**
   * Band the device is fitted into; bottom may exceed 1 to bleed off-canvas. `width` fixes the
   * frame width as a fraction of the tile width instead of fitting the band; `cx`/`cy` move the
   * centre (fractions of composition width / tile height) off the band centre. Ignored, but
   * still required by the type, when `deviceless` is set — see its own doc.
   */
  device: { top: number; bottom: number; width?: number; cx?: number; cy?: number }
  padX: number
  /** Multiplies the base type sizes (fractions of *tile height*); default 1. A short tile — a
   *  landscape banner — needs this well above 1 to read as a headline rather than a caption. */
  textScale?: number
  /**
   * `true` = `renderScene` draws no device and no artwork placement for this layout, whatever the
   * slot's kind or arrangement — the composition is copy (and stickers/shapes) alone. `text`'s
   * band is then the auto-shrink's own limit, not the gap to a device band (`availableTextHeight`).
   * Absent (the default) behaves exactly as before this field existed.
   */
  deviceless?: true
  /**
   * Band for the list block (`feature-wall` only) — same convention as `text`. Absent means the
   * layout carries no list, as every layout but `feature-wall` does.
   */
  list?: { top: number; height: number; left?: number; width?: number }
  /**
   * `true` = the rows of the text block share one edge and `textAlign: 'center'` centres the block
   * as a whole, so a short subhead lines up under a headline that fills its box instead of sitting
   * centred beneath it. Absent: every row is aligned on its own.
   */
  textColumn?: true
}

export type ExportSize = {
  id: string
  label: string
  store: 'App Store' | 'Google Play' | 'Studio'
  w: number
  h: number
}

export type Screen = {
  id: string
  headline: string
  subhead: string
  /** key into the image registry; null while the slot is empty */
  imageId: string | null
  /** 'artwork' = no source screenshot and no device frame is ever drawn for this screen, however
   *  its arrangement is set; absent means the ordinary framed screen. Set by the project bridge. */
  kind?: 'artwork'
  /** key into the image registry for the slot's frameless artwork; absent = the slot names none */
  artworkId?: string | null
  /** key into the image registry for the screen this one pairs with; absent = use the neighbour */
  pairId?: string | null
  /** the same for the `prev` frame of a multi-device arrangement; absent = use the neighbour */
  pairPrevId?: string | null
  /** per-screen overrides; any key absent here inherits from the global settings */
  overrides: ScreenOverrides
  /** BCP-47 language of the copy; picks the script font and text direction. Absent = Latin, LTR. */
  lang?: string
  /** one line drawn above the headline, uppercase; absent = none. No markup — stars are literal. */
  eyebrow?: string
  /** free-standing images (stickers) drawn behind or in front of the composition; absent = none */
  elements?: SceneElement[]
  /** `feature-wall`'s list rows, one entry each, `*starred*` words highlighted like the headline;
   *  absent or empty = none drawn. Ignored by every other layout. */
  list?: string[]
  /** keys into the image registry for the mosaic layout's extra cells (the first cell is always
   *  `imageId`); absent or empty = the slot names none. Set by the project bridge from a slot's
   *  `extra`, mirroring `pairId`/`pairPrevId`. */
  extraIds?: string[]
}

/** Export size is deliberately global — every shot in a set must share one canvas size. */
export type OverridableKey = Exclude<keyof Settings, 'sizeId'>
/** The settings with no entry in `DEFAULT_SETTINGS`: absent is their own, meaningful default. */
export type OptionalSettingKey = 'deviceOffset' | 'textOffset' | 'browserUrl' | 'backBlur' | 'deviceFade'

/** How the device runs out at the bottom: into black, or into whatever is behind it. */
export type DeviceFade = 'dark' | 'background'
export type ScreenOverrides = Partial<Pick<Settings, OverridableKey>>

export type TextAlign = 'center' | 'left'

/** One step of a rhythm: which composition a tile takes. Applied as overrides by screen index. */
export type RhythmStep = { layout: LayoutId; positionId: string; textAlign?: TextAlign }

/** The strip's rhythm, independent of the look: Goldie's template idea. Empty steps = uniform. */
export type Rhythm = { id: string; label: string; description: string; steps: RhythmStep[] }

/** The four colour keys a palette pair carries. Same shapes as their `Settings` counterparts,
 *  so `effectiveSettings` can swap them in wholesale for a "contrast tile". */
export type PaletteColors = {
  background: Background
  textColor: string
  eyebrowColor: string | null
  highlights: string[]
}

/** A named colour scheme with a second, contrasting pair for the "contrast tile" toggle. */
export type Palette = {
  id: string
  label: string
  colors: PaletteColors
  alt: PaletteColors
}

export type Settings = {
  background: Background
  /** rounded card drawn behind the device band; null = none */
  backdropColor: string | null
  deviceId: string
  frameColorId: string
  /** the drop shadow a device frame casts; default 'soft' is the frame's original look */
  deviceShadow: DeviceShadow
  positionId: string
  layout: LayoutId
  tilt: number
  deviceScale: number
  /** moves the whole arrangement — every placement together, or the mosaic grid as one unit.
   *  Optional with no default, unlike every other key: absent is "where the layout puts it", so
   *  a template reset or a set that never used it writes nothing (see `Offset`). */
  deviceOffset?: Offset
  /** moves the copy: the text block (accent bar, eyebrow, headline, subhead) and feature-wall's
   *  list with it, as one unit. Same convention as `deviceOffset`. */
  textOffset?: Offset
  /** the text in a browser frame's address field; absent leaves the field empty */
  browserUrl?: string
  /** blurs every frame of a multi-device arrangement but the front one */
  backBlur?: boolean
  deviceFade?: DeviceFade
  textColor: string
  /** eyebrow's own color; null = same as textColor */
  eyebrowColor: string | null
  textAlign: TextAlign
  /** marker bands behind `*starred*` headline words; spans cycle through the list */
  highlights: string[]
  fontId: string
  /** multipliers on the base headline / subtitle size */
  headlineScale: number
  subheadScale: number
  /** headline letter-spacing as a fraction of the font size (em) */
  headlineTracking: number
  /** short, fully rounded bar drawn above the block (above the eyebrow, if any); null = none */
  accentBar: string | null
  /** 'label' draws each subhead line on a rounded box in `highlights[0]`, weight 600, fully
   *  opaque; falls back to 'plain' (today's look) when there are no highlights to draw it in */
  subheadStyle: 'plain' | 'label'
  sizeId: string
  /** the picked palette's second pair, for the "contrast tile" toggle; null = none picked */
  altColors: PaletteColors | null
  /** when true and `altColors` is set, `effectiveSettings` swaps the four colour keys for it */
  inverted: boolean
}

/**
 * A template is a complete look: a settings preset plus optional per-screen variants
 * that cycle by screen index (alternating backgrounds, tilts, highlight colours), which is
 * what gives a store listing its rhythm. Applying one resets the set to it.
 */
export type TemplateSpec = {
  id: string
  label: string
  /** one line for the gallery card */
  description: string
  /** applied on top of the defaults; export size and device are always kept */
  settings: Partial<Omit<Settings, 'sizeId' | 'deviceId'>>
  /** overrides pinned on screen `i` are `variants[i % variants.length]` */
  variants?: ScreenOverrides[]
  /** the rhythm the variants follow, for the picker; absent = the template's own */
  rhythm?: string
  /** sample copy for the gallery thumbnail (first) and the empty editor (one per card) */
  samples: { headline: string; subhead: string }[]
}
