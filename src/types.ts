export type Background =
  { kind: 'solid'; color: string } | { kind: 'gradient'; from: string; to: string; angle: number }

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

export type SceneElementLayer = 'behind' | 'front'

/** A shape element's silhouette. One kind today; the union leaves room for more. */
export type ShapeKind = 'circle'

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

/** A filled deco shape — no image, no shadow. */
export type ShapeElement = SceneElementBase & {
  shape: ShapeKind
  color: string
}

export type SceneElement = StickerElement | ShapeElement

export const isShapeElement = (el: SceneElement): el is ShapeElement => 'shape' in el
export const isStickerElement = (el: SceneElement): el is StickerElement => !isShapeElement(el)

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
   * centre (fractions of composition width / tile height) off the band centre.
   */
  device: { top: number; bottom: number; width?: number; cx?: number; cy?: number }
  padX: number
  /** Multiplies the base type sizes (fractions of *tile height*); default 1. A short tile — a
   *  landscape banner — needs this well above 1 to read as a headline rather than a caption. */
  textScale?: number
}

export type ExportSize = {
  id: string
  label: string
  store: 'App Store' | 'Google Play'
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
}

/** Export size is deliberately global — every shot in a set must share one canvas size. */
export type OverridableKey = Exclude<keyof Settings, 'sizeId'>
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
  positionId: string
  layout: LayoutId
  tilt: number
  deviceScale: number
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
