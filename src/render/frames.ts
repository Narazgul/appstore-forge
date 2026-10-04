import type { DeviceShadow, DeviceSpec, FrameColor, ShapeKind } from '../types'

export type Box = { x: number; y: number; w: number; h: number }

/** Chrome blurs a canvas shadow with sigma = blur / 2, the Skia build the CLI renders with about
 *  1.35 times wider for the same number; the editor widens its blur to look like the stored image. */
export const shadowBlurScale = (browser = typeof document !== 'undefined') => (browser ? 1.35 : 1)

/**
 * The one place that sets a shadow on the context — a device frame and (via `drawSticker`) a
 * sticker both cast the same 'soft' shadow, and a future frameless element can reuse this
 * instead of re-deriving the numbers. 'hard' draws flat, no blur, offset diagonally down-right
 * by 0.03 of `frameW`; `color` is only read for 'hard' (a soft shadow's colour is fixed).
 */
export function applyShadow(
  ctx: CanvasRenderingContext2D,
  style: DeviceShadow,
  frameW: number,
  color: string,
) {
  if (style === 'none') return
  if (style === 'hard') {
    ctx.shadowColor = color
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = frameW * 0.03
    ctx.shadowOffsetY = frameW * 0.03
    return
  }
  ctx.shadowColor = 'rgba(15, 23, 42, 0.30)'
  ctx.shadowBlur = frameW * 0.09 * shadowBlurScale()
  ctx.shadowOffsetY = frameW * 0.035
}

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath()
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.max(0, Math.min(r, b.w / 2, b.h / 2)))
}

export const imageSize = (img: CanvasImageSource) => ({
  w: (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width,
  h: (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height,
})

/** Where a cover-fitted, top-anchored image of `iw`×`ih` lands in `b`: its top-left and scale. */
export function coverTop(iw: number, ih: number, b: Box): { x: number; y: number; scale: number } {
  const scale = Math.max(b.w / iw, b.h / ih)
  return { x: b.x + (b.w - iw * scale) / 2, y: b.y, scale }
}

/** Cover-fit an image into a box, anchored to the top so the status bar is never cropped. */
function drawCoverTop(ctx: CanvasRenderingContext2D, img: CanvasImageSource, b: Box) {
  const { w: iw, h: ih } = imageSize(img)
  if (!iw || !ih) return
  const fit = coverTop(iw, ih, b)
  ctx.drawImage(img, fit.x, fit.y, iw * fit.scale, ih * fit.scale)
}

/** The screen area inside a device frame drawn at `box`, and its corner radius. */
export function deviceScreen(box: Box, device: DeviceSpec): { screen: Box; radius: number } {
  const outerR = device.radius * box.w
  const bezel = device.bezel * box.w
  const bar = (device.toolbar ?? 0) * box.w
  return {
    screen: { x: box.x + bezel, y: box.y + bezel + bar, w: box.w - bezel * 2, h: box.h - bezel * 2 - bar },
    radius: Math.max(0, outerR - bezel),
  }
}

/**
 * An image on its own: contain-fitted and centred in the box, no body, no bezel, no notch.
 * Nothing is filled behind it, so a PNG with an alpha channel keeps the background showing through.
 */
export function drawArtwork(ctx: CanvasRenderingContext2D, box: Box, img: CanvasImageSource) {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
  if (!iw || !ih) return
  const scale = Math.min(box.w / iw, box.h / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh)
}

/**
 * A sticker: the image alone, drawn at exactly `box`, optionally with the same soft drop shadow
 * a device frame casts. Unlike `drawArtwork` this never fits into a band — the caller already
 * sized `box` from the sticker's own width and the image's aspect ratio.
 */
export function drawSticker(
  ctx: CanvasRenderingContext2D,
  box: Box,
  img: CanvasImageSource,
  shadow: boolean,
) {
  ctx.save()
  if (shadow) applyShadow(ctx, 'soft', box.w, '')
  ctx.drawImage(img, box.x, box.y, box.w, box.h)
  ctx.restore()
}

const DEFAULT_RING_STROKE = 0.12
const DEFAULT_BLOB_SEED = 1
const BLOB_POINT_COUNT = 7
const BLOB_MIN_RADIUS = 0.78
const BLOB_MAX_RADIUS = 1
/** Fraction of the even angular step a point may drift by, so the spacing stays "leicht gejittert". */
const BLOB_ANGLE_JITTER = 0.3

/** A small, seeded PRNG (mulberry32) — the only randomness `blobPoints` uses, so the same seed
 *  always yields the same numbers, in the browser and under Node's `@napi-rs/canvas` alike. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Seven points around the unit circle for a blob's `seed`, radius `[0.78, 1.0]` and angle
 * jittered off its even spacing — deterministic from `seed` alone, so the GUI and the CLI always
 * draw the same blob. Every point is within radius 1 of the centre, i.e. inside the box a
 * diameter-1 circle inscribes.
 */
export function blobPoints(seed: number): { x: number; y: number }[] {
  const rand = mulberry32(seed)
  const step = (Math.PI * 2) / BLOB_POINT_COUNT
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < BLOB_POINT_COUNT; i++) {
    const r = BLOB_MIN_RADIUS + rand() * (BLOB_MAX_RADIUS - BLOB_MIN_RADIUS)
    const angle = i * step + (rand() - 0.5) * step * BLOB_ANGLE_JITTER
    points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r })
  }
  return points
}

/** Closes `points` (unit-circle-relative) into a smooth loop with a Catmull-Rom-to-Bézier
 *  conversion, scaled and centred into `box`. Does not fill or stroke — the caller decides. */
function tracePath(ctx: CanvasRenderingContext2D, box: Box, points: { x: number; y: number }[]) {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const r = box.w / 2
  const n = points.length
  const p = points.map((pt) => ({ x: cx + pt.x * r, y: cy + pt.y * r }))
  ctx.beginPath()
  ctx.moveTo(p[0].x, p[0].y)
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n]
    const p1 = p[i]
    const p2 = p[(i + 1) % n]
    const p3 = p[(i + 2) % n]
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    )
  }
  ctx.closePath()
}

/**
 * A chip's pill: a fully rounded rect, optionally with the same soft drop shadow a sticker or a
 * device frame casts. The caller has already fitted `box` from the shrunk text plus its own
 * padding — this only fills the shape, the text is a separate call (`drawLine` in `render/text.ts`).
 */
export function drawPill(ctx: CanvasRenderingContext2D, box: Box, color: string, shadow: boolean) {
  ctx.save()
  if (shadow) applyShadow(ctx, 'soft', box.w, '')
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(box.x, box.y, box.w, box.h, box.h / 2)
  ctx.fill()
  ctx.restore()
}

/**
 * A filled deco shape: no image, no shadow, unlike `drawSticker`. `box` is already square — the
 * caller sized it from the element's own `width` as an outer diameter, not an image's aspect
 * ratio. `stroke` (ring only) and `seed` (blob only) fall back to their defaults when the kind
 * that uses them leaves it out; the other kind's value, if set, is simply never read here —
 * `validateProject` is what rejects a field on the wrong shape.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  box: Box,
  shape: ShapeKind,
  color: string,
  stroke?: number,
  seed?: number,
) {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  if (shape === 'circle') {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(cx, cy, box.w / 2, box.h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
  } else if (shape === 'ring') {
    // The stroke sits centred on a circle pulled in by half its own width, so the outer edge —
    // not the path — lands exactly on the box, keeping the ring fully inside it.
    const strokeW = (stroke ?? DEFAULT_RING_STROKE) * box.w
    const r = box.w / 2 - strokeW / 2
    ctx.strokeStyle = color
    ctx.lineWidth = strokeW
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (shape === 'blob') {
    ctx.fillStyle = color
    tracePath(ctx, box, blobPoints(seed ?? DEFAULT_BLOB_SEED))
    ctx.fill()
  }
}

/** A mosaic cell's corner radius, as a fraction of the cell's own width — independent of any
 *  device's `radius`, since a cell is never a device (`_context/rules.md` still applies: this is
 *  geometry, not a bitmap). */
const MOSAIC_CELL_RADIUS = 0.045

/**
 * One rahmenloses mosaic cell: a white card with exactly the same drop shadow `drawDevice` casts
 * (`applyShadow`, the tile's `deviceShadow` setting), the image cover-fitted top-anchored (rule 5)
 * and clipped to the card's rounded corners — no bezel, no notch. A missing image leaves the white
 * card empty, exactly like a device with no screenshot. `shadowColor` is only read for `'hard'`,
 * same as `drawDevice`.
 */
export function drawMosaicCell(
  ctx: CanvasRenderingContext2D,
  box: Box,
  img: CanvasImageSource | null,
  shadowStyle: DeviceShadow,
  shadowColor: string,
) {
  const r = box.w * MOSAIC_CELL_RADIUS

  ctx.save()
  applyShadow(ctx, shadowStyle, box.w, shadowColor)
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, box, r)
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRect(ctx, box, r)
  ctx.clip()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(box.x, box.y, box.w, box.h)
  if (img) drawCoverTop(ctx, img, box)
  ctx.restore()
}

function drawNotch(ctx: CanvasRenderingContext2D, screen: Box, device: DeviceSpec, frameW: number) {
  if (device.notch === 'island') {
    const w = frameW * 0.3
    const h = frameW * 0.085
    ctx.fillStyle = '#08080a'
    roundRect(ctx, { x: screen.x + (screen.w - w) / 2, y: screen.y + frameW * 0.028, w, h }, h / 2)
    ctx.fill()
  } else if (device.notch === 'punch') {
    const r = frameW * 0.026
    ctx.fillStyle = '#08080a'
    ctx.beginPath()
    ctx.arc(screen.x + screen.w / 2, screen.y + frameW * 0.055, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** The address field of a browser frame: its text, and how to set the font for it. */
export type BrowserBar = { url?: string; font: (ctx: CanvasRenderingContext2D, size: number) => void }

/** Only a near-black frame colour gets the dark bar: the phone default (deep blue) reads as light. */
const isDarkBody = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 40
}

/** A browser window: title bar with three window buttons and an address field, the page below
 *  with only its bottom corners rounded. */
function drawBrowser(
  ctx: CanvasRenderingContext2D,
  box: Box,
  device: DeviceSpec,
  color: FrameColor,
  img: CanvasImageSource | null,
  shadowStyle: DeviceShadow,
  shadowColor: string,
  bar: BrowserBar | undefined,
) {
  const r = device.radius * box.w
  const { screen } = deviceScreen(box, device)
  const barH = screen.y - box.y
  const dark = isDarkBody(color.body)

  ctx.save()
  applyShadow(ctx, shadowStyle, box.w, shadowColor)
  ctx.fillStyle = dark ? '#2b2d31' : '#eceef1'
  roundRect(ctx, box, r)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(screen.x, screen.y, screen.w, screen.h, [0, 0, r, r])
  ctx.clip()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h)
  if (img) drawCoverTop(ctx, img, screen)
  ctx.restore()

  ctx.save()
  const line = Math.max(1, box.w * 0.0012)
  ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.12)'
  ctx.fillRect(box.x, screen.y - line, box.w, line)
  ctx.strokeStyle = dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.14)'
  ctx.lineWidth = line
  roundRect(ctx, { x: box.x + line / 2, y: box.y + line / 2, w: box.w - line, h: box.h - line }, r)
  ctx.stroke()

  const dot = barH * 0.24
  const cy = box.y + barH / 2
  ;['#ff5f57', '#febc2e', '#28c840'].forEach((fill, i) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(box.x + barH * 0.55 + i * dot * 1.65, cy, dot / 2, 0, Math.PI * 2)
    ctx.fill()
  })

  const fieldH = barH * 0.58
  const fieldW = Math.min(box.w * 0.56, box.w - barH * 4.2)
  const field: Box = { x: box.x + (box.w - fieldW) / 2, y: cy - fieldH / 2, w: fieldW, h: fieldH }
  ctx.fillStyle = dark ? '#3c3f46' : '#ffffff'
  roundRect(ctx, field, fieldH / 2)
  ctx.fill()

  const url = bar?.url?.trim()
  if (url && bar) {
    const size = fieldH * 0.5
    const ink = dark ? '#c9ccd3' : '#5f6368'
    bar.font(ctx, size)
    const lock = size * 0.62
    const gap = size * 0.45
    const maxText = field.w - fieldH * 1.2 - lock - gap
    let text = url
    if (ctx.measureText(text).width > maxText) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxText) text = text.slice(0, -1)
      text = `${text}…`
    }
    const textW = ctx.measureText(text).width
    const left = field.x + (field.w - (lock + gap + textW)) / 2
    ctx.fillStyle = ink
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.direction = 'ltr'
    ctx.fillText(text, left + lock + gap, cy - size * 0.44 + size * 0.8)
    ctx.strokeStyle = ink
    ctx.lineWidth = lock * 0.16
    ctx.beginPath()
    ctx.arc(left + lock / 2, cy - lock * 0.12, lock * 0.26, Math.PI, 0)
    ctx.stroke()
    roundRect(ctx, { x: left, y: cy - lock * 0.12, w: lock, h: lock * 0.62 }, lock * 0.12)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Draw a device frame with the screenshot inside it. `box` is the outer frame bounds;
 * the caller is responsible for having already fitted `box` to the frame's aspect ratio.
 * `shadowColor` is only read for `shadowStyle: 'hard'` — the effective text colour of the tile.
 * `bar` is only read by a browser frame.
 */
export function drawDevice(
  ctx: CanvasRenderingContext2D,
  box: Box,
  device: DeviceSpec,
  color: FrameColor,
  img: CanvasImageSource | null,
  shadowStyle: DeviceShadow,
  shadowColor: string,
  bar?: BrowserBar,
) {
  if (device.toolbar) {
    drawBrowser(ctx, box, device, color, img, shadowStyle, shadowColor, bar)
    return
  }
  const outerR = device.radius * box.w
  const bezel = device.bezel * box.w
  const { screen, radius: screenR } = deviceScreen(box, device)

  ctx.save()
  applyShadow(ctx, shadowStyle, box.w, shadowColor)

  if (bezel > 0) {
    ctx.fillStyle = color.body
    roundRect(ctx, box, outerR)
    ctx.fill()
  } else {
    // Frameless: the shadow has to come from the screenshot's own silhouette.
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, box, outerR)
    ctx.fill()
  }
  ctx.restore()

  if (bezel > 0) {
    ctx.save()
    ctx.strokeStyle = color.edge
    ctx.lineWidth = Math.max(1, box.w * 0.005)
    roundRect(
      ctx,
      {
        x: box.x + ctx.lineWidth / 2,
        y: box.y + ctx.lineWidth / 2,
        w: box.w - ctx.lineWidth,
        h: box.h - ctx.lineWidth,
      },
      outerR,
    )
    ctx.stroke()
    ctx.restore()
  }

  ctx.save()
  roundRect(ctx, screen, screenR)
  ctx.clip()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h)
  if (img) drawCoverTop(ctx, img, screen)
  drawNotch(ctx, screen, device, box.w)
  ctx.restore()
}
