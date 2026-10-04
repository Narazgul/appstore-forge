import type {
  Background,
  BackgroundImage,
  DitherFinish,
  DuotoneFinish,
  Finish,
  FinishKind,
  GrainFinish,
  HalftoneFinish,
  MotionFinish,
  NewsprintFinish,
  ReededFinish,
  RisoFinish,
} from '../types'
import { parseHexColor } from '../lib/contrast'
import { blurRegion, scratchCanvas, type Pixels } from './effects'

export const IMAGE_DEFAULTS = { focusX: 0.5, focusY: 0.5, zoom: 1, blur: 0, brightness: 1 }

/** Lengths are fractions of the tile width, so a finish looks the same at every export size. */
export const FINISH_DEFAULTS = {
  grain: { amount: 0.08, size: 0.0012, mono: true, seed: 1 },
  motion: { length: 0.05, angle: 0 },
  halftone: { cell: 0.014, angle: 45, paper: '#ffffff' },
  newsprint: { cell: 0.01, angle: 45, ink: '#1c1c1c', paper: '#efe9dc', seed: 1 },
  dither: { pixel: 0.0025, dark: '#1b1b1f', light: '#f2efe6' },
  riso: {
    inks: ['#ff6c2f', '#3255a4'] as [string, string],
    paper: '#f5f0e6',
    offset: 0.004,
    grain: 0.1,
    seed: 1,
  },
  duotone: { dark: '#1f2a44', light: '#f6d7a7' },
  reeded: { rib: 0.04, strength: 0.6, direction: 'vertical' as const },
} satisfies Record<FinishKind, object>

export const FINISH_KINDS = Object.keys(FINISH_DEFAULTS) as FinishKind[]

export const hasBackgroundLayers = (bg: Background): boolean => !!bg.image || !!bg.finish?.length

/** Where a cover-fitted image lands in a `W`×`H` area: scaled to fill, then `zoom`ed, with the
 *  focus point as near the centre as the image's edges allow. */
export function coverBox(iw: number, ih: number, W: number, H: number, image: BackgroundImage) {
  const zoom = Math.max(1, image.zoom ?? IMAGE_DEFAULTS.zoom)
  const scale = Math.max(W / iw, H / ih) * zoom
  const w = iw * scale
  const h = ih * scale
  const place = (size: number, room: number, focus: number) =>
    Math.min(0, Math.max(room - size, room / 2 - focus * size))
  return {
    x: place(w, W, image.focusX ?? IMAGE_DEFAULTS.focusX),
    y: place(h, H, image.focusY ?? IMAGE_DEFAULTS.focusY),
    w,
    h,
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rgb = (hex: string) => {
  const { r, g, b } = parseHexColor(hex)
  return [r, g, b]
}

const luma = (d: Uint8ClampedArray, i: number) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

const smooth = (lo: number, hi: number, v: number) => {
  const t = clamp01((v - lo) / (hi - lo))
  return t * t * (3 - 2 * t)
}

const copyOf = (px: Pixels): Pixels => ({ data: new Uint8ClampedArray(px.data), w: px.w, h: px.h })

const blurred = (px: Pixels, radius: number): Pixels => {
  const copy = copyOf(px)
  if (radius >= 1) blurRegion(copy, { x0: 0, y0: 0, x1: px.w, y1: px.h }, radius)
  return copy
}

function grain(px: Pixels, unit: number, f: GrainFinish) {
  const o = { ...FINISH_DEFAULTS.grain, ...f }
  const cell = Math.max(1, Math.round(o.size * unit))
  const rand = mulberry32(o.seed)
  const amp = o.amount * 255
  const d = px.data
  for (let cy = 0; cy < px.h; cy += cell) {
    for (let cx = 0; cx < px.w; cx += cell) {
      const n0 = (rand() + rand() - 1) * amp
      const n1 = o.mono ? n0 : (rand() + rand() - 1) * amp
      const n2 = o.mono ? n0 : (rand() + rand() - 1) * amp
      for (let y = cy; y < Math.min(cy + cell, px.h); y++) {
        for (let x = cx; x < Math.min(cx + cell, px.w); x++) {
          const i = (y * px.w + x) * 4
          d[i] += n0
          d[i + 1] += n1
          d[i + 2] += n2
        }
      }
    }
  }
}

function motion(px: Pixels, unit: number, f: MotionFinish) {
  const o = { ...FINISH_DEFAULTS.motion, ...f }
  const len = Math.max(1, Math.round(o.length * unit))
  const taps = Math.min(len + 1, 32)
  const rad = (o.angle * Math.PI) / 180
  const offsets: [number, number][] = []
  for (let k = 0; k < taps; k++) {
    const t = taps === 1 ? 0 : -len / 2 + (len * k) / (taps - 1)
    offsets.push([Math.round(Math.cos(rad) * t), Math.round(Math.sin(rad) * t)])
  }
  const src = new Uint8ClampedArray(px.data)
  const d = px.data
  const { w, h } = px
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (const [ox, oy] of offsets) {
        const sx = x + ox < 0 ? 0 : x + ox >= w ? w - 1 : x + ox
        const sy = y + oy < 0 ? 0 : y + oy >= h ? h - 1 : y + oy
        const j = (sy * w + sx) * 4
        r += src[j]
        g += src[j + 1]
        b += src[j + 2]
      }
      const i = (y * w + x) * 4
      d[i] = r / taps
      d[i + 1] = g / taps
      d[i + 2] = b / taps
    }
  }
}

/** Calls `dot` once per pixel with the colour sampled at the centre of its screen cell, how far
 *  the pixel lies from that centre (in cells) and the cell size in pixels. */
function screenCells(
  px: Pixels,
  cellPx: number,
  angle: number,
  dot: (i: number, sample: number, dist: number) => void,
) {
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const { w, h } = px
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x * cos + y * sin) / cellPx
      const v = (-x * sin + y * cos) / cellPx
      const cu = Math.floor(u) + 0.5
      const cv = Math.floor(v) + 0.5
      const sx = Math.round((cu * cos - cv * sin) * cellPx)
      const sy = Math.round((cu * sin + cv * cos) * cellPx)
      const j = ((sy < 0 ? 0 : sy >= h ? h - 1 : sy) * w + (sx < 0 ? 0 : sx >= w ? w - 1 : sx)) * 4
      dot((y * w + x) * 4, j, Math.hypot(u - cu, v - cv))
    }
  }
}

const DOT_MAX = 0.72

function halftone(px: Pixels, unit: number, f: HalftoneFinish) {
  const o = { ...FINISH_DEFAULTS.halftone, ...f }
  const cellPx = Math.max(3, o.cell * unit)
  const src = blurred(px, cellPx / 2).data
  const paper = rgb(o.paper)
  const d = px.data
  screenCells(px, cellPx, o.angle, (i, j, dist) => {
    const r = Math.sqrt(1 - luma(src, j)) * DOT_MAX
    const alpha = clamp01((r - dist) * cellPx + 0.5)
    const cover = Math.min(1, Math.PI * r * r)
    for (let c = 0; c < 3; c++) {
      const ink = cover > 0 ? (src[j + c] - paper[c] * (1 - cover)) / cover : src[j + c]
      const clamped = ink < 0 ? 0 : ink > 255 ? 255 : ink
      d[i + c] = paper[c] + (clamped - paper[c]) * alpha
    }
  })
}

function newsprint(px: Pixels, unit: number, f: NewsprintFinish) {
  const o = { ...FINISH_DEFAULTS.newsprint, ...f }
  const cellPx = Math.max(3, o.cell * unit)
  const src = blurred(px, cellPx / 2).data
  const ink = rgb(o.ink)
  const paper = rgb(o.paper)
  const d = px.data
  screenCells(px, cellPx, o.angle, (i, j, dist) => {
    const r = Math.sqrt(smooth(0.05, 0.95, 1 - luma(src, j))) * DOT_MAX
    const alpha = clamp01((r - dist) * cellPx + 0.5)
    for (let c = 0; c < 3; c++) d[i + c] = paper[c] + (ink[c] - paper[c]) * alpha
  })
  grain(px, unit, { kind: 'grain', amount: 0.05, size: 0.0008, seed: o.seed })
}

function dither(px: Pixels, unit: number, f: DitherFinish) {
  const o = { ...FINISH_DEFAULTS.dither, ...f }
  const p = Math.max(1, Math.round(o.pixel * unit))
  const gw = Math.ceil(px.w / p)
  const gh = Math.ceil(px.h / p)
  const grid = new Float64Array(gw * gh)
  const d = px.data
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0
      let n = 0
      for (let y = gy * p; y < Math.min((gy + 1) * p, px.h); y++)
        for (let x = gx * p; x < Math.min((gx + 1) * p, px.w); x++, n++) sum += luma(d, (y * px.w + x) * 4)
      grid[gy * gw + gx] = sum / n
    }
  }
  // Atkinson: passes on three quarters of the error, which keeps highlights and shadows clean.
  const spread: [number, number][] = [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
  ]
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const k = gy * gw + gx
      const value = grid[k] < 0.5 ? 0 : 1
      const err = (grid[k] - value) / 8
      grid[k] = value
      for (const [dx, dy] of spread) {
        const x = gx + dx
        const y = gy + dy
        if (x >= 0 && x < gw && y < gh) grid[y * gw + x] += err
      }
    }
  }
  const dark = rgb(o.dark)
  const light = rgb(o.light)
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      const color = grid[Math.floor(y / p) * gw + Math.floor(x / p)] ? light : dark
      const i = (y * px.w + x) * 4
      d[i] = color[0]
      d[i + 1] = color[1]
      d[i + 2] = color[2]
    }
  }
}

/** Two inks as density per channel (Beer-Lambert), and the inverse of their 2×2 normal matrix, so
 *  each pixel's coverages are a least-squares fit of its own density. */
function inkModel(a: number[], b: number[], paper: number[]) {
  const dens = (ink: number[]) => ink.map((v, c) => -Math.log(Math.max(1, v) / Math.max(1, paper[c])))
  const da = dens(a)
  const db = dens(b)
  const aa = da.reduce((n, v) => n + v * v, 0)
  const bb = db.reduce((n, v) => n + v * v, 0)
  const ab = da.reduce((n, v, c) => n + v * db[c], 0)
  const det = aa * bb - ab * ab || 1
  return { da, db, inv: [bb / det, -ab / det, -ab / det, aa / det] }
}

function riso(px: Pixels, unit: number, f: RisoFinish) {
  const o = { ...FINISH_DEFAULTS.riso, ...f }
  const [a, b] = o.inks.map(rgb)
  const paper = rgb(o.paper)
  const { da, db, inv } = inkModel(a, b, paper)
  const shift = Math.round(o.offset * unit)
  const shiftY = Math.round(shift * 0.6)
  const src = blurred(px, unit * 0.0015).data
  const { w, h } = px
  const covA = new Float64Array(w * h)
  const covB = new Float64Array(w * h)
  for (let k = 0; k < w * h; k++) {
    let ta = 0
    let tb = 0
    for (let c = 0; c < 3; c++) {
      const t = -Math.log(Math.max(1, src[k * 4 + c]) / Math.max(1, paper[c]))
      ta += t * da[c]
      tb += t * db[c]
    }
    covA[k] = inv[0] * ta + inv[1] * tb
    covB[k] = inv[2] * ta + inv[3] * tb
  }
  const rand = mulberry32(o.seed)
  const d = px.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      const bx = x - shift < 0 ? 0 : x - shift >= w ? w - 1 : x - shift
      const by = y - shiftY < 0 ? 0 : y - shiftY >= h ? h - 1 : y - shiftY
      const ca = clamp01(covA[k] + (rand() - 0.5) * 2 * o.grain)
      const cb = clamp01(covB[by * w + bx] + (rand() - 0.5) * 2 * o.grain)
      for (let c = 0; c < 3; c++) d[k * 4 + c] = paper[c] * Math.exp(-ca * da[c] - cb * db[c])
    }
  }
}

function duotone(px: Pixels, f: DuotoneFinish) {
  const o = { ...FINISH_DEFAULTS.duotone, ...f }
  const dark = rgb(o.dark)
  const light = rgb(o.light)
  const d = px.data
  for (let i = 0; i < d.length; i += 4) {
    const t = smooth(0.02, 0.98, luma(d, i))
    for (let c = 0; c < 3; c++) d[i + c] = dark[c] + (light[c] - dark[c]) * t
  }
}

function reeded(px: Pixels, unit: number, f: ReededFinish) {
  const o = { ...FINISH_DEFAULTS.reeded, ...f }
  const rib = Math.max(4, o.rib * unit)
  const vertical = o.direction !== 'horizontal'
  const len = vertical ? px.w : px.h
  const from = new Int32Array(len)
  const shade = new Float64Array(len)
  // Each rib is a small lens: it shows a strip wider than itself, squeezed into its own width.
  const spread = 1 + 2 * o.strength
  for (let k = 0; k < len; k++) {
    const t = (k % rib) / rib
    const centre = k - t * rib + rib / 2
    const s = Math.round(centre + (t - 0.5) * rib * spread)
    from[k] = s < 0 ? 0 : s >= len ? len - 1 : s
    shade[k] = 1 + 0.08 * Math.sin(Math.PI * t) - 0.05 - (t < 0.06 ? 0.06 : 0)
  }
  // Fluted glass smears across its ribs and keeps the detail along them.
  motion(px, unit, { kind: 'motion', length: (rib * 0.35) / unit, angle: vertical ? 0 : 90 })
  const src = new Uint8ClampedArray(px.data)
  const d = px.data
  const { w, h } = px
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const j = vertical ? (y * w + from[x]) * 4 : (from[y] * w + x) * 4
      const s = shade[vertical ? x : y]
      d[i] = src[j] * s
      d[i + 1] = src[j + 1] * s
      d[i + 2] = src[j + 2] * s
    }
  }
}

/** One finish on the background's pixels; `unit` is the tile width in pixels. */
export function applyFinish(px: Pixels, finish: Finish, unit: number) {
  switch (finish.kind) {
    case 'grain':
      return grain(px, unit, finish)
    case 'motion':
      return motion(px, unit, finish)
    case 'halftone':
      return halftone(px, unit, finish)
    case 'newsprint':
      return newsprint(px, unit, finish)
    case 'dither':
      return dither(px, unit, finish)
    case 'riso':
      return riso(px, unit, finish)
    case 'duotone':
      return duotone(px, finish)
    case 'reeded':
      return reeded(px, unit, finish)
  }
}

function tone(px: Pixels, image: BackgroundImage, unit: number) {
  const blur = (image.blur ?? IMAGE_DEFAULTS.blur) * unit
  if (blur >= 1) blurRegion(px, { x0: 0, y0: 0, x1: px.w, y1: px.h }, blur)
  const brightness = image.brightness ?? IMAGE_DEFAULTS.brightness
  if (brightness === 1) return
  const d = px.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] *= brightness
    d[i + 1] *= brightness
    d[i + 2] *= brightness
  }
}

/**
 * The background with its image and finishes, built on a canvas of its own before anything else is
 * drawn, so no finish can ever reach a device, the copy or an element. `w` is the tile width the
 * finish lengths count in; `drawBase` paints the plain colour or gradient underneath.
 */
export function drawLayeredBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  w: number,
  h: number,
  bg: Background,
  image: CanvasImageSource | null | undefined,
  drawBase: (ctx: CanvasRenderingContext2D, w: number, h: number, bg: Background) => void,
) {
  const m = ctx.getTransform()
  const scale = m.a || 1
  const pw = Math.max(1, Math.round(W * scale))
  const ph = Math.max(1, Math.round(h * scale))
  const layer = scratchCanvas(ctx, pw, ph)
  const lctx = layer.getContext('2d')!
  drawBase(lctx, pw, ph, bg)
  const img = bg.image && image ? image : null
  if (img) {
    const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
    const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
    if (iw && ih) {
      const box = coverBox(iw, ih, pw, ph, bg.image!)
      lctx.imageSmoothingEnabled = true
      lctx.imageSmoothingQuality = 'high'
      lctx.drawImage(img, box.x, box.y, box.w, box.h)
    }
  }
  const finishes = bg.finish ?? []
  let out: ImageData | null = null
  if (img || finishes.length) {
    let px: Pixels
    try {
      px = { data: lctx.getImageData(0, 0, pw, ph).data, w: pw, h: ph }
    } catch {
      // A cross-origin image without CORS taints the layer; the image still shows, unfinished.
      ctx.drawImage(layer, 0, 0, W, h)
      return
    }
    if (img) tone(px, bg.image!, w * scale)
    for (const finish of finishes) applyFinish(px, finish, w * scale)
    out = lctx.createImageData(pw, ph)
    out.data.set(px.data)
  }
  if (m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0) {
    ctx.putImageData(out ?? lctx.getImageData(0, 0, pw, ph), 0, 0)
    return
  }
  if (out) lctx.putImageData(out, 0, 0)
  ctx.drawImage(layer, 0, 0, W, h)
}
