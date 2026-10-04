import type { DeviceSpec, EffectElement, LiftEffect, LoupeEffect, ScreenRect } from '../types'
import { coverTop, deviceScreen, imageSize, type Box } from './frames'

export type Pixels = { data: Uint8ClampedArray; w: number; h: number }
type PixelRect = { x0: number; y0: number; x1: number; y1: number }

/** `base` is what the device shows; `clean` is the screen after redaction only, which the lifted
 *  part and the loupe sample — sharp and undimmed, but never showing what was redacted. */
export type PreparedScreen = { base: CanvasImageSource; clean: CanvasImageSource; w: number; h: number }

export function scratchCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): HTMLCanvasElement {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    return canvas
  }
  // Under @napi-rs/canvas the context's own canvas class builds a scratch canvas it can draw.
  const Canvas = (ctx.canvas as unknown as { constructor: new (w: number, h: number) => HTMLCanvasElement })
    .constructor
  return new Canvas(w, h)
}

function readPixels(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number): Pixels {
  const scratch = scratchCanvas(ctx, w, h).getContext('2d')!
  scratch.drawImage(img, 0, 0, w, h)
  return { data: scratch.getImageData(0, 0, w, h).data, w, h }
}

function toCanvas(ctx: CanvasRenderingContext2D, px: Pixels): HTMLCanvasElement {
  const canvas = scratchCanvas(ctx, px.w, px.h)
  const out = canvas.getContext('2d')!
  const image = out.createImageData(px.w, px.h)
  image.data.set(px.data)
  out.putImageData(image, 0, 0)
  return canvas
}

export function pixelRect(rect: ScreenRect, pad: number, w: number, h: number): PixelRect {
  const p = pad * w
  return {
    x0: Math.max(0, Math.min(w, Math.floor(rect.x * w - p))),
    y0: Math.max(0, Math.min(h, Math.floor(rect.y * h - p))),
    x1: Math.max(0, Math.min(w, Math.ceil((rect.x + rect.w) * w + p))),
    y1: Math.max(0, Math.min(h, Math.ceil((rect.y + rect.h) * h + p))),
  }
}

function boxPass(src: Uint8ClampedArray, w: number, h: number, r: number, horizontal: boolean) {
  const out = new Uint8ClampedArray(src.length)
  const n = 2 * r + 1
  const lines = horizontal ? h : w
  const len = horizontal ? w : h
  const at = (line: number, i: number) => {
    const k = i < 0 ? 0 : i >= len ? len - 1 : i
    return horizontal ? (line * w + k) * 4 : (k * w + line) * 4
  }
  for (let line = 0; line < lines; line++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0
      for (let i = -r; i <= r; i++) sum += src[at(line, i) + c]
      for (let i = 0; i < len; i++) {
        out[at(line, i) + c] = Math.round(sum / n)
        sum += src[at(line, i + r + 1) + c] - src[at(line, i - r) + c]
      }
    }
  }
  return out
}

// Three box passes each way come close to a Gaussian, in integers, so every run is byte-identical.
export function blurRegion(px: Pixels, region: PixelRect, radius: number) {
  const w = region.x1 - region.x0
  const h = region.y1 - region.y0
  const r = Math.max(1, Math.round(radius))
  if (w <= 0 || h <= 0) return
  let buf = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    buf.set(
      px.data.subarray(((region.y0 + y) * px.w + region.x0) * 4, ((region.y0 + y) * px.w + region.x1) * 4),
      y * w * 4,
    )
  for (let pass = 0; pass < 3; pass++) {
    buf = boxPass(buf, w, h, r, true)
    buf = boxPass(buf, w, h, r, false)
  }
  for (let y = 0; y < h; y++)
    px.data.set(buf.subarray(y * w * 4, (y + 1) * w * 4), ((region.y0 + y) * px.w + region.x0) * 4)
}

function pixelateRegion(px: Pixels, region: PixelRect, block: number) {
  const b = Math.max(2, Math.round(block))
  for (let by = region.y0; by < region.y1; by += b) {
    for (let bx = region.x0; bx < region.x1; bx += b) {
      const ex = Math.min(bx + b, region.x1)
      const ey = Math.min(by + b, region.y1)
      const sum = [0, 0, 0, 0]
      for (let y = by; y < ey; y++)
        for (let x = bx; x < ex; x++) for (let c = 0; c < 4; c++) sum[c] += px.data[(y * px.w + x) * 4 + c]
      const count = (ex - bx) * (ey - by)
      const avg = sum.map((v) => Math.round(v / count))
      for (let y = by; y < ey; y++)
        for (let x = bx; x < ex; x++) for (let c = 0; c < 4; c++) px.data[(y * px.w + x) * 4 + c] = avg[c]
    }
  }
}

function recede(px: Pixels, dim: number, gray: number) {
  if (dim <= 0 && gray <= 0) return
  const d = px.data
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      const i = (y * px.w + x) * 4
      const luma = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
      for (let c = 0; c < 3; c++) d[i + c] = Math.round((d[i + c] + (luma - d[i + c]) * gray) * (1 - dim))
    }
  }
}

function copyRegion(from: Pixels, to: Pixels, region: PixelRect) {
  for (let y = region.y0; y < region.y1; y++)
    to.data.set(
      from.data.subarray((y * from.w + region.x0) * 4, (y * from.w + region.x1) * 4),
      (y * to.w + region.x0) * 4,
    )
}

const pixelKey = (effects: EffectElement[]) =>
  JSON.stringify(
    effects.map((e) =>
      e.effect === 'loupe'
        ? null
        : e.effect === 'lift'
          ? ['lift', e.dim, e.gray]
          : e.effect === 'focus'
            ? ['focus', e.rect, e.pad, e.strength, e.dim]
            : ['redact', e.rect, e.pad, e.style, e.strength],
    ),
  )

const CACHE_PER_IMAGE = 4
const prepared = new WeakMap<object, Map<string, PreparedScreen>>()

function computeScreen(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  effects: EffectElement[],
  w: number,
  h: number,
): PreparedScreen {
  const redacts = effects.filter((e) => e.effect === 'redact')
  const focuses = effects.filter((e) => e.effect === 'focus')
  const lifts = effects.filter((e): e is LiftEffect => e.effect === 'lift')
  const dim = Math.max(0, ...lifts.map((e) => e.dim))
  const gray = Math.max(0, ...lifts.map((e) => e.gray))
  if (!redacts.length && !focuses.length && dim <= 0 && gray <= 0) return { base: img, clean: img, w, h }

  let px = readPixels(ctx, img, w, h)
  for (const e of redacts) {
    const region = pixelRect(e.rect, e.pad, w, h)
    if (e.style === 'blur') blurRegion(px, region, e.strength * w)
    else pixelateRegion(px, region, e.strength * w)
  }
  const clean = redacts.length ? toCanvas(ctx, px) : img
  for (const e of focuses) {
    const sharp = pixelRect(e.rect, e.pad, w, h)
    const blurred: Pixels = { data: new Uint8ClampedArray(px.data), w, h }
    blurRegion(blurred, { x0: 0, y0: 0, x1: w, y1: h }, e.strength * w)
    recede(blurred, e.dim, 0)
    copyRegion(px, blurred, sharp)
    px = blurred
  }
  recede(px, dim, gray)
  return { base: toCanvas(ctx, px), clean, w, h }
}

/** Cached because the editor redraws on every edit. A cross-origin image refuses its pixels: then
 *  the raw screenshot is drawn, so the editor keeps working. */
export function prepareScreen(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  effects: EffectElement[],
): PreparedScreen {
  const { w, h } = imageSize(img)
  if (!w || !h) return { base: img, clean: img, w, h }
  const key = `${w}x${h}:${pixelKey(effects)}`
  const forImage = prepared.get(img as object) ?? new Map<string, PreparedScreen>()
  const known = forImage.get(key)
  if (known) return known
  let result: PreparedScreen
  try {
    result = computeScreen(ctx, img, effects, w, h)
  } catch {
    return { base: img, clean: img, w, h }
  }
  if (forImage.size >= CACHE_PER_IMAGE) forImage.delete(forImage.keys().next().value!)
  forImage.set(key, result)
  prepared.set(img as object, forImage)
  return result
}

const LIFT_SHADOW = 'rgba(15, 23, 42, 0.35)'
const LOUPE_MIN = 0.18
const LOUPE_MAX = 0.45
const LOUPE_GAP = 0.06

export function loupeCircle(
  e: LoupeEffect,
  target: Box,
  tileW: number,
): { cx: number; cy: number; d: number } {
  const d =
    e.size !== undefined
      ? e.size * tileW
      : Math.min(LOUPE_MAX * tileW, Math.max(LOUPE_MIN * tileW, Math.max(target.w, target.h) * e.zoom * 1.15))
  const cx = target.x + target.w / 2
  const cy = target.y + target.h / 2
  const reach = d / 2 + d * LOUPE_GAP
  switch (e.place) {
    case 'above':
      return { cx, cy: target.y - reach, d }
    case 'below':
      return { cx, cy: target.y + target.h + reach, d }
    case 'left':
      return { cx: target.x - reach, cy, d }
    case 'right':
      return { cx: target.x + target.w + reach, cy, d }
    default:
      return { cx, cy, d }
  }
}

function drawLift(
  ctx: CanvasRenderingContext2D,
  e: LiftEffect,
  src: CanvasImageSource,
  px: PixelRect,
  target: Box,
  screenW: number,
) {
  const w = target.w * e.scale
  const h = target.h * e.scale
  const lifted: Box = { x: target.x + (target.w - w) / 2, y: target.y + (target.h - h) / 2, w, h }
  const r = Math.min(Math.min(w, h) * 0.12, screenW * 0.035)
  ctx.save()
  ctx.shadowColor = LIFT_SHADOW
  ctx.shadowBlur = screenW * 0.06
  ctx.shadowOffsetY = screenW * 0.02
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(lifted.x, lifted.y, lifted.w, lifted.h, r)
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(lifted.x, lifted.y, lifted.w, lifted.h, r)
  ctx.clip()
  ctx.drawImage(src, px.x0, px.y0, px.x1 - px.x0, px.y1 - px.y0, lifted.x, lifted.y, lifted.w, lifted.h)
  ctx.restore()
}

function drawLoupe(
  ctx: CanvasRenderingContext2D,
  e: LoupeEffect,
  src: CanvasImageSource,
  size: { w: number; h: number },
  px: PixelRect,
  target: Box,
  scale: number,
  tileW: number,
) {
  const { cx, cy, d } = loupeCircle(e, target, tileW)
  const r = d / 2
  const zoomScale = scale * e.zoom
  const pcx = (px.x0 + px.x1) / 2
  const pcy = (px.y0 + px.y1) / 2
  const half = r / zoomScale
  const sx0 = Math.max(0, pcx - half)
  const sy0 = Math.max(0, pcy - half)
  const sx1 = Math.min(size.w, pcx + half)
  const sy1 = Math.min(size.h, pcy + half)

  ctx.save()
  ctx.shadowColor = LIFT_SHADOW
  ctx.shadowBlur = d * 0.12
  ctx.shadowOffsetY = d * 0.04
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  if (sx1 > sx0 && sy1 > sy0)
    ctx.drawImage(
      src,
      sx0,
      sy0,
      sx1 - sx0,
      sy1 - sy0,
      cx + (sx0 - pcx) * zoomScale,
      cy + (sy0 - pcy) * zoomScale,
      (sx1 - sx0) * zoomScale,
      (sy1 - sy0) * zoomScale,
    )
  ctx.restore()

  const rim = d * 0.045
  ctx.save()
  ctx.strokeStyle = e.ring
  ctx.lineWidth = rim
  ctx.beginPath()
  ctx.arc(cx, cy, r - rim / 2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.18)'
  ctx.lineWidth = Math.max(1, d * 0.006)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// Not clipped to the screen: a lifted part and a loupe may reach past the frame.
export function drawEffectOverlays(
  ctx: CanvasRenderingContext2D,
  box: Box,
  angle: number,
  device: DeviceSpec,
  screenImage: PreparedScreen,
  effects: EffectElement[],
  tileW: number,
) {
  const { w: iw, h: ih } = screenImage
  if (!iw || !ih) return
  const { screen } = deviceScreen(box, device)
  const fit = coverTop(iw, ih, screen)
  const onCanvas = (px: PixelRect): Box => ({
    x: fit.x + px.x0 * fit.scale,
    y: fit.y + px.y0 * fit.scale,
    w: (px.x1 - px.x0) * fit.scale,
    h: (px.y1 - px.y0) * fit.scale,
  })
  const ordered = [
    ...effects.filter((e) => e.effect === 'lift'),
    ...effects.filter((e) => e.effect === 'loupe'),
  ]
  if (!ordered.length) return

  ctx.save()
  if (angle !== 0) {
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2)
    ctx.rotate((angle * Math.PI) / 180)
    ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2))
  }
  for (const e of ordered) {
    const px = pixelRect(e.rect, e.pad, iw, ih)
    if (px.x1 <= px.x0 || px.y1 <= px.y0) continue
    if (e.effect === 'lift') drawLift(ctx, e, screenImage.clean, px, onCanvas(px), screen.w)
    else if (e.effect === 'loupe')
      drawLoupe(ctx, e, screenImage.clean, { w: iw, h: ih }, px, onCanvas(px), fit.scale, tileW)
  }
  ctx.restore()
}
