import { toHexColor } from '../lib/contrast'
import type { Background } from '../types'
import { drawLayeredBackground } from './finishes'
import { drawBackground } from './scene'
import type { BlockBox } from './text'

/** The background alone, image and finishes included, exactly as `renderScene` lays it down first. */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  w: number,
  h: number,
  bg: Background,
  image: CanvasImageSource | null | undefined,
) {
  drawLayeredBackground(ctx, W, w, h, bg, image, drawBackground)
}

/** The mean colour of the pixels inside `box` (canvas pixels, clamped to the canvas): what the text
 *  block reads against. Null when the box holds no pixel. */
export function meanColorIn(ctx: CanvasRenderingContext2D, box: BlockBox): string | null {
  const { width, height } = ctx.canvas
  const x0 = Math.max(0, Math.floor(box.x))
  const y0 = Math.max(0, Math.floor(box.y))
  const x1 = Math.min(width, Math.ceil(box.x + box.w))
  const y1 = Math.min(height, Math.ceil(box.y + box.h))
  if (x1 <= x0 || y1 <= y0) return null
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  const n = data.length / 4
  return toHexColor({ r: r / n, g: g / n, b: b / n })
}
