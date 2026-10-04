export type Bounds = { left: number; right: number; top: number; bottom: number }

const ALPHA_FLOOR = 8
const SAMPLE_SIDE = 256

/** The box around the pixels that are not (nearly) transparent, as fractions of the image. Null
 *  when nothing is drawn at all. */
export function opaqueBounds(data: Uint8ClampedArray, w: number, h: number): Bounds | null {
  let x0 = w
  let x1 = -1
  let y0 = h
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < ALPHA_FLOOR) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  return { left: x0 / w, right: (x1 + 1) / w, top: y0 / h, bottom: (y1 + 1) / h }
}

/** `opaqueBounds` of a picture, sampled at no more than `SAMPLE_SIDE` pixels on its long side. */
export function imageOpaqueBounds(
  img: { width: number; height: number } & CanvasImageSource,
  context: (w: number, h: number) => CanvasRenderingContext2D,
): Bounds | null {
  const scale = Math.min(1, SAMPLE_SIDE / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const ctx = context(w, h)
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return opaqueBounds(ctx.getImageData(0, 0, w, h).data, w, h)
}
