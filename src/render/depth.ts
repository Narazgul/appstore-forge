import type { DeviceFade } from '../types'
import { blurRegion, scratchCanvas } from './effects'
import type { Box } from './frames'

/** Blur radius of a back device, as a fraction of the tile width. */
export const BACK_BLUR = 0.009
/** How much of the devices' visible height the fade covers, from the bottom up. */
export const FADE_SHARE = 0.38

/** A canvas the size of `ctx`'s, drawing in the same units. */
function layerLike(ctx: CanvasRenderingContext2D) {
  const canvas = scratchCanvas(ctx, ctx.canvas.width, ctx.canvas.height)
  const layer = canvas.getContext('2d')!
  layer.setTransform(ctx.getTransform())
  return { canvas, layer }
}

function paste(ctx: CanvasRenderingContext2D, canvas: CanvasImageSource) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(canvas, 0, 0)
  ctx.restore()
}

/** The axis-aligned bounds of `box` turned by `angle` degrees about its centre. */
export function turnedBounds(box: Box, angle: number): Box {
  const a = (angle * Math.PI) / 180
  const w = Math.abs(box.w * Math.cos(a)) + Math.abs(box.h * Math.sin(a))
  const h = Math.abs(box.w * Math.sin(a)) + Math.abs(box.h * Math.cos(a))
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

/**
 * Draws through `draw` onto a layer, blurs the layer around `bounds` (premultiplied, so the
 * transparent surroundings bleed no dark fringe) and pastes it onto `ctx`. Integer box passes, so
 * every run is byte-identical.
 */
export function drawBlurred(
  ctx: CanvasRenderingContext2D,
  bounds: Box,
  radius: number,
  draw: (layer: CanvasRenderingContext2D) => void,
) {
  const { canvas, layer } = layerLike(ctx)
  draw(layer)
  const t = ctx.getTransform()
  const r = radius * t.a
  const margin = r * 3
  const x0 = Math.max(0, Math.floor(bounds.x * t.a + t.e - margin))
  const y0 = Math.max(0, Math.floor(bounds.y * t.d + t.f - margin))
  const x1 = Math.min(canvas.width, Math.ceil((bounds.x + bounds.w) * t.a + t.e + margin))
  const y1 = Math.min(canvas.height, Math.ceil((bounds.y + bounds.h) * t.d + t.f + margin))
  if (x1 > x0 && y1 > y0 && r > 0) {
    const image = layer.getImageData(x0, y0, x1 - x0, y1 - y0)
    const data = image.data
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      data[i] = Math.round((data[i] * a) / 255)
      data[i + 1] = Math.round((data[i + 1] * a) / 255)
      data[i + 2] = Math.round((data[i + 2] * a) / 255)
    }
    blurRegion({ data, w: x1 - x0, h: y1 - y0 }, { x0: 0, y0: 0, x1: x1 - x0, y1: y1 - y0 }, r)
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      if (!a) continue
      data[i] = Math.min(255, Math.round((data[i] * 255) / a))
      data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / a))
      data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / a))
    }
    layer.save()
    layer.setTransform(1, 0, 0, 1, 0, 0)
    layer.putImageData(image, x0, y0)
    layer.restore()
  }
  paste(ctx, canvas)
}

/** The band the fade runs over: the lower part of what the devices show of themselves. */
export function fadeBand(bounds: Box[], h: number): { top: number; bottom: number } | null {
  if (!bounds.length) return null
  const top = Math.max(0, Math.min(...bounds.map((b) => b.y)))
  const bottom = Math.min(h, Math.max(...bounds.map((b) => b.y + b.h)))
  if (bottom <= top) return null
  return { top: bottom - (bottom - top) * FADE_SHARE, bottom }
}

/**
 * Draws the devices through `draw` so they run out at the bottom: `dark` lays a black gradient
 * over the whole width from the band down; `background` erases the devices along the band, so
 * whatever lies behind them shows through.
 */
export function drawFaded(
  ctx: CanvasRenderingContext2D,
  W: number,
  h: number,
  fade: DeviceFade,
  band: { top: number; bottom: number } | null,
  draw: (target: CanvasRenderingContext2D) => void,
) {
  if (!band) {
    draw(ctx)
    return
  }
  if (fade === 'dark') {
    draw(ctx)
    const g = ctx.createLinearGradient(0, band.top, 0, band.bottom)
    g.addColorStop(0, 'rgba(0, 0, 0, 0)')
    g.addColorStop(0.55, 'rgba(0, 0, 0, 0.55)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0.94)')
    ctx.save()
    ctx.fillStyle = g
    ctx.fillRect(0, band.top, W, band.bottom - band.top)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.94)'
    if (band.bottom < h) ctx.fillRect(0, band.bottom, W, h - band.bottom)
    ctx.restore()
    return
  }
  const { canvas, layer } = layerLike(ctx)
  draw(layer)
  const g = layer.createLinearGradient(0, band.top, 0, band.bottom)
  g.addColorStop(0, 'rgba(0, 0, 0, 0)')
  g.addColorStop(1, 'rgba(0, 0, 0, 1)')
  layer.save()
  layer.globalCompositeOperation = 'destination-out'
  layer.fillStyle = g
  layer.fillRect(0, band.top, W, band.bottom - band.top)
  layer.fillStyle = '#000000'
  if (band.bottom < h) layer.fillRect(0, band.bottom, W, h - band.bottom)
  layer.restore()
  paste(ctx, canvas)
}
