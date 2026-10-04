/** fal.ai image-to-image model `forge bg paint` repaints a background with. */
export const PAINT_MODEL = 'fal-ai/flux-pro/kontext'
/** fal.ai's price for one image of `PAINT_MODEL` (flat per image), checked 2026-10-04. */
export const PAINT_PRICE_USD = 0.04

export const PAINT_STYLES = {
  oil: 'a classic oil painting on canvas, thick impasto brush strokes, rich layered colour, visible canvas texture',
  watercolor:
    'a delicate watercolour painting on cold-press paper, soft wet-in-wet washes, granulating pigment, white paper showing through, gentle bleeding edges',
  ink: 'a Japanese sumi ink wash painting, expressive black brush strokes, graded grey washes, lots of empty paper',
  gouache:
    'a flat gouache illustration, opaque matte colour areas, crisp shapes, subtle brush texture, mid-century poster palette',
} as const
export type PaintStyle = keyof typeof PAINT_STYLES
export const PAINT_STYLE_IDS = Object.keys(PAINT_STYLES) as PaintStyle[]

export const paintPrompt = (style: PaintStyle) =>
  `Repaint this image as ${PAINT_STYLES[style]}. Keep the composition, the horizon and every main shape exactly where they are. No text, no frame, no signature, no people added.`
