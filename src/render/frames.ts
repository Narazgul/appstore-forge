import type { DeviceShadow, DeviceSpec, FrameColor, ShapeKind } from '../types'

export type Box = { x: number; y: number; w: number; h: number }

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
  ctx.shadowBlur = frameW * 0.09
  ctx.shadowOffsetY = frameW * 0.035
}

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath()
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.max(0, Math.min(r, b.w / 2, b.h / 2)))
}

/** Cover-fit an image into a box, anchored to the top so the status bar is never cropped. */
function drawCoverTop(ctx: CanvasRenderingContext2D, img: CanvasImageSource, b: Box) {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
  if (!iw || !ih) return
  const scale = Math.max(b.w / iw, b.h / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(img, b.x + (b.w - dw) / 2, b.y, dw, dh)
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

/**
 * Draw a device frame with the screenshot inside it. `box` is the outer frame bounds;
 * the caller is responsible for having already fitted `box` to the frame's aspect ratio.
 * `shadowColor` is only read for `shadowStyle: 'hard'` — the effective text colour of the tile.
 */
export function drawDevice(
  ctx: CanvasRenderingContext2D,
  box: Box,
  device: DeviceSpec,
  color: FrameColor,
  img: CanvasImageSource | null,
  shadowStyle: DeviceShadow,
  shadowColor: string,
) {
  const outerR = device.radius * box.w
  const bezel = device.bezel * box.w
  const screen: Box = {
    x: box.x + bezel,
    y: box.y + bezel,
    w: box.w - bezel * 2,
    h: box.h - bezel * 2,
  }
  const screenR = Math.max(0, outerR - bezel)

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
