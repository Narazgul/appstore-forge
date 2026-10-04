import { contrastRatio } from '../lib/contrast'
import { isRtl } from '../presets/scripts'
import type {
  ArrowMark,
  DeviceSpec,
  HighlightMark,
  LabelMark,
  MarkElement,
  MarkSide,
  MarkTarget,
  OutlineMark,
  ScreenRect,
  Settings,
  StepMark,
} from '../types'
import { pixelRect } from './effects'
import { coverTop, deviceScreen, drawPill, type Box } from './frames'
import { CHIP_HEIGHT, CHIP_PAD_X, drawLine, fitChipText, setChipFont, type Line } from './text'

/** Where the slot's own screenshot landed: its device box and turn, and the image's pixel size. */
export type ScreenPlacement = { box: Box; angle: number; device: DeviceSpec; iw: number; ih: number }

export type MarkScene = {
  /** composition width, tile width, tile height */
  W: number
  w: number
  h: number
  /** the tile's shorter side, which sizes and line widths are fractions of */
  unit: number
  screen: ScreenPlacement | null
  textBox: () => Box | null
  settings: Settings
  lang?: string
}

/** A box turned by `angle` (radians) about its own centre. */
export type Frame = { cx: number; cy: number; w: number; h: number; angle: number }

const STRONG_RED = '#ff4b2b'
const DARK = '#111114'
const LIGHT = '#ffffff'
const MARK_SHADOW = 'rgba(15, 23, 42, 0.28)'
const DARK_BAND_ALPHA = 0.4

const opaque = (hex: string) =>
  hex.length === 9 ? hex.slice(0, 7) : hex.length === 5 ? hex.slice(0, 4) : hex

/** White on anything it reads on as large bold type (3:1), near-black on light colours. */
export const readableOn = (color: string) => (contrastRatio(LIGHT, opaque(color)) >= 3 ? LIGHT : DARK)

/** A mark's colour when the slot names none: the set's accent, else a red that reads on any screen. */
export const markColor = (settings: Settings) => settings.accentBar ?? settings.eyebrowColor ?? STRONG_RED

function turn(x: number, y: number, cx: number, cy: number, angle: number) {
  if (!angle) return { x, y }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = x - cx
  const dy = y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** The part of the screenshot on the canvas, cut to the visible screen and turned with the device. */
export function screenFrame(p: ScreenPlacement, rect: ScreenRect, pad: number): Frame | null {
  const px = pixelRect(rect, pad, p.iw, p.ih)
  const { screen } = deviceScreen(p.box, p.device)
  const fit = coverTop(p.iw, p.ih, screen)
  const x0 = Math.max(screen.x, fit.x + px.x0 * fit.scale)
  const y0 = Math.max(screen.y, fit.y + px.y0 * fit.scale)
  const x1 = Math.min(screen.x + screen.w, fit.x + px.x1 * fit.scale)
  const y1 = Math.min(screen.y + screen.h, fit.y + px.y1 * fit.scale)
  if (x1 <= x0 || y1 <= y0) return null
  const angle = (p.angle * Math.PI) / 180
  const c = turn((x0 + x1) / 2, (y0 + y1) / 2, p.box.x + p.box.w / 2, p.box.y + p.box.h / 2, angle)
  return { cx: c.x, cy: c.y, w: x1 - x0, h: y1 - y0, angle }
}

export function targetFrame(t: MarkTarget, scene: MarkScene): Frame | null {
  if (t.on === 'tile')
    return { cx: t.x * scene.W, cy: t.y * scene.h, w: t.w * scene.w, h: t.h * scene.h, angle: 0 }
  if (t.on === 'text') {
    const box = scene.textBox()
    return box ? { cx: box.x + box.w / 2, cy: box.y + box.h / 2, w: box.w, h: box.h, angle: 0 } : null
  }
  return scene.screen ? screenFrame(scene.screen, t.rect, t.pad) : null
}

/** The point `gap` beyond the middle of one edge of `f`, or its centre. */
export function sidePoint(f: Frame, side: MarkSide, gap: number) {
  const local =
    side === 'left'
      ? { x: -f.w / 2 - gap, y: 0 }
      : side === 'right'
        ? { x: f.w / 2 + gap, y: 0 }
        : side === 'top'
          ? { x: 0, y: -f.h / 2 - gap }
          : side === 'bottom'
            ? { x: 0, y: f.h / 2 + gap }
            : { x: 0, y: 0 }
  return turn(f.cx + local.x, f.cy + local.y, f.cx, f.cy, f.angle)
}

/** Where a line from the centre of `f` towards `to` leaves its edge, `gap` further out. */
export function edgeToward(f: Frame, to: { x: number; y: number }, gap: number) {
  const local = turn(to.x, to.y, f.cx, f.cy, -f.angle)
  const dx = local.x - f.cx
  const dy = local.y - f.cy
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: f.cx, y: f.cy }
  const reach = Math.min(
    dx === 0 ? Infinity : f.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : f.h / 2 / Math.abs(dy),
  )
  const t = Math.min(1, (Number.isFinite(reach) ? reach : 0) + gap / len)
  return turn(f.cx + dx * t, f.cy + dy * t, f.cx, f.cy, f.angle)
}

/** The arrow's two ends and the control point of its quadratic curve. */
export function arrowPath(el: ArrowMark, from: Frame, to: Frame, gap: number) {
  const aim = (f: Frame, side: MarkSide | undefined) => (side ? sidePoint(f, side, 0) : { x: f.cx, y: f.cy })
  const endOn = (f: Frame, side: MarkSide | undefined, other: { x: number; y: number }) =>
    f.w === 0 && f.h === 0 ? { x: f.cx, y: f.cy } : side ? sidePoint(f, side, gap) : edgeToward(f, other, gap)
  const start = endOn(from, el.from.side, aim(to, el.to.side))
  const end = endOn(to, el.to.side, aim(from, el.from.side))
  const dx = end.x - start.x
  const dy = end.y - start.y
  const control = { x: (start.x + end.x) / 2 - dy * el.curve, y: (start.y + end.y) / 2 + dx * el.curve }
  return { start, end, control }
}

const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

function drawArrow(ctx: CanvasRenderingContext2D, el: ArrowMark, scene: MarkScene, color: string) {
  const from = targetFrame(el.from, scene)
  const to = targetFrame(el.to, scene)
  if (!from || !to) return
  const stroke = el.stroke * scene.unit
  const { start, end, control } = arrowPath(el, from, to, stroke * 2.4)
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length < stroke * 4) return
  const headLen = stroke * 4.2
  const headW = stroke * 3.8
  const tx = end.x - control.x
  const ty = end.y - control.y
  const tl = Math.hypot(tx, ty) || 1
  const ux = tx / tl
  const uy = ty / tl
  const base = { x: end.x - ux * headLen, y: end.y - uy * headLen }
  const head = [
    end,
    { x: base.x - uy * (headW / 2), y: base.y + ux * (headW / 2) },
    { x: base.x + uy * (headW / 2), y: base.y - ux * (headW / 2) },
  ]
  // Cut the curve where the head begins, or the round cap shows beside the tip.
  const cut = Math.max(0, 1 - (headLen * 0.75) / length)
  const p1 = lerp(start, control, cut)
  const p2 = lerp(lerp(start, control, cut), lerp(control, end, cut), cut)
  const casing = readableOn(color) === LIGHT ? LIGHT : DARK

  const trace = (c: CanvasRenderingContext2D) => {
    c.beginPath()
    c.moveTo(start.x, start.y)
    c.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y)
  }
  const traceHead = (c: CanvasRenderingContext2D) => {
    c.beginPath()
    c.moveTo(head[0].x, head[0].y)
    c.lineTo(head[1].x, head[1].y)
    c.lineTo(head[2].x, head[2].y)
    c.closePath()
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = MARK_SHADOW
  ctx.shadowBlur = stroke * 2
  ctx.shadowOffsetY = stroke * 0.5
  ctx.strokeStyle = casing
  ctx.fillStyle = casing
  ctx.lineWidth = stroke * 1.9
  trace(ctx)
  ctx.stroke()
  ctx.lineWidth = stroke * 0.9
  traceHead(ctx)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = stroke
  trace(ctx)
  ctx.stroke()
  traceHead(ctx)
  ctx.fill()
  ctx.restore()
}

function drawStep(ctx: CanvasRenderingContext2D, el: StepMark, scene: MarkScene, color: string) {
  const f = targetFrame(el.at, scene)
  if (!f || !el.n) return
  const d = el.size * scene.unit
  const side = el.at.side ?? (el.at.on === 'screen' ? 'left' : 'center')
  const c = sidePoint(f, side, side === 'center' ? 0 : d * 0.62)
  const ring = d * 0.07

  ctx.save()
  ctx.shadowColor = MARK_SHADOW
  ctx.shadowBlur = d * 0.18
  ctx.shadowOffsetY = d * 0.05
  ctx.fillStyle = readableOn(color) === LIGHT ? LIGHT : DARK
  ctx.beginPath()
  ctx.arc(c.x, c.y, d / 2 + ring, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(c.x, c.y, d / 2, 0, Math.PI * 2)
  ctx.fill()
  let size = d * 0.54
  setChipFont(ctx, size, scene.settings, scene.lang)
  let width = ctx.measureText(el.n).width
  for (let i = 0; i < 12 && width > d * 0.68; i++) {
    size *= 0.9
    setChipFont(ctx, size, scene.settings, scene.lang)
    width = ctx.measureText(el.n).width
  }
  ctx.fillStyle = el.textColor ?? readableOn(color)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.direction = 'ltr'
  const line: Line = { words: [{ text: el.n, span: -1 }], widths: [width], width }
  // Digits carry no descender: their middle sits about 0.36 em above the baseline, not at the em box's.
  drawLine(ctx, line, c.x - width / 2, c.y - size * 0.44, size, [], false)
  ctx.restore()
}

/** Average brightness (0–1) of what is already drawn under `f`; null when the canvas will not say. */
function brightnessUnder(ctx: CanvasRenderingContext2D, f: Frame): number | null {
  try {
    const t = ctx.getTransform()
    const x0 = Math.max(0, Math.floor((f.cx - f.w / 2) * t.a + t.e))
    const y0 = Math.max(0, Math.floor((f.cy - f.h / 2) * t.d + t.f))
    const x1 = Math.min(ctx.canvas.width, Math.ceil((f.cx + f.w / 2) * t.a + t.e))
    const y1 = Math.min(ctx.canvas.height, Math.ceil((f.cy + f.h / 2) * t.d + t.f))
    if (x1 <= x0 || y1 <= y0) return null
    const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
    let sum = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4 * 7) {
      sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      count++
    }
    return count ? sum / count / 255 : null
  } catch {
    return null
  }
}

function drawHighlight(ctx: CanvasRenderingContext2D, el: HighlightMark, scene: MarkScene) {
  const f = targetFrame(el.at, scene)
  if (!f || f.w <= 0 || f.h <= 0) return
  const color = el.color ?? scene.settings.highlights[0] ?? '#ffe27a'
  const ext = f.h * 0.14
  const light = (brightnessUnder(ctx, f) ?? 1) >= 0.45
  ctx.save()
  ctx.translate(f.cx, f.cy)
  if (f.angle) ctx.rotate(f.angle)
  if (light) {
    // Multiplied over a light page the marker darkens the paper, never the text.
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = el.opacity
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(-f.w / 2 - ext, -f.h / 2 + f.h * 0.04, f.w + ext * 2, f.h, Math.min(f.h * 0.2, f.h / 2))
    ctx.fill()
  } else {
    // Multiply would vanish on a dark page; screen only lightens, so light text stays the lightest
    // thing in the band, and a glowing rim marks the edge.
    const padY = f.h * 0.18
    const w = f.w + ext * 2
    const h = f.h + padY * 2
    const r = Math.min(f.h * 0.3, h / 2)
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, r)
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = el.opacity * DARK_BAND_ALPHA
    ctx.fillStyle = color
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = el.opacity
    ctx.shadowColor = color
    ctx.shadowBlur = f.h * 0.6
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.5, f.h * 0.08)
    ctx.stroke()
  }
  ctx.restore()
}

const outlineGap = (stroke: number) => stroke * 1.4

function drawOutline(ctx: CanvasRenderingContext2D, el: OutlineMark, scene: MarkScene, color: string) {
  const f = targetFrame(el.at, scene)
  if (!f || f.w <= 0 || f.h <= 0) return
  const stroke = el.stroke * scene.unit
  const gap = outlineGap(stroke)
  const w = f.w + gap * 2
  const h = f.h + gap * 2
  const r = Math.min(Math.min(w, h) / 2, scene.unit * 0.03)
  const casing = readableOn(color) === LIGHT ? LIGHT : DARK
  ctx.save()
  ctx.translate(f.cx, f.cy)
  if (f.angle) ctx.rotate(f.angle)
  ctx.shadowColor = MARK_SHADOW
  ctx.shadowBlur = stroke * 2
  ctx.strokeStyle = casing
  ctx.lineWidth = stroke * 1.9
  ctx.beginPath()
  ctx.roundRect(-w / 2, -h / 2, w, h, r)
  ctx.stroke()
  ctx.shadowColor = 'transparent'
  ctx.strokeStyle = color
  ctx.lineWidth = stroke
  ctx.stroke()
  ctx.restore()
}

/** The pill a label draws: beside its target on `side`, kept inside the composition. */
export function labelBox(ctx: CanvasRenderingContext2D, el: LabelMark, f: Frame, scene: MarkScene) {
  const fit = fitChipText(ctx, el.caption, scene.settings, scene.w * 0.7, el.size * scene.h, scene.lang)
  const pillH = fit.size * CHIP_HEIGHT
  const padX = fit.size * CHIP_PAD_X
  const pillW = fit.textWidth + padX * 2
  const side = el.at.side ?? (el.at.on === 'screen' ? 'right' : 'center')
  const p = sidePoint(f, side, scene.unit * 0.035)
  let x = side === 'left' ? p.x - pillW : side === 'right' ? p.x : p.x - pillW / 2
  let y = side === 'top' ? p.y - pillH : side === 'bottom' ? p.y : p.y - pillH / 2
  const margin = scene.unit * 0.02
  x = Math.min(Math.max(x, margin), scene.W - margin - pillW)
  y = Math.min(Math.max(y, margin), scene.h - margin - pillH)
  return { fit, padX, box: { x, y, w: pillW, h: pillH } }
}

function drawLabel(ctx: CanvasRenderingContext2D, el: LabelMark, scene: MarkScene, color: string) {
  const f = targetFrame(el.at, scene)
  if (!f || !el.caption) return
  const { fit, padX, box } = labelBox(ctx, el, f, scene)
  ctx.save()
  drawPill(ctx, box, color, true)
  const rtl = isRtl(scene.lang)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.fillStyle = el.textColor ?? readableOn(color)
  const line: Line = {
    words: [{ text: el.caption, span: -1 }],
    widths: [fit.textWidth],
    width: fit.textWidth,
  }
  drawLine(ctx, line, box.x + padX, box.y + (box.h - fit.size) / 2, fit.size, [], rtl)
  ctx.restore()
}

/** Draws every mark in order, over everything else on the tile. */
export function drawMarks(ctx: CanvasRenderingContext2D, marks: MarkElement[], scene: MarkScene) {
  const accent = markColor(scene.settings)
  for (const el of marks) {
    if (el.mark === 'highlight') drawHighlight(ctx, el, scene)
    else if (el.mark === 'arrow') drawArrow(ctx, el, scene, el.color ?? accent)
    else if (el.mark === 'step') drawStep(ctx, el, scene, el.color ?? accent)
    else if (el.mark === 'outline') drawOutline(ctx, el, scene, el.color ?? accent)
    else drawLabel(ctx, el, scene, el.color ?? accent)
  }
}
