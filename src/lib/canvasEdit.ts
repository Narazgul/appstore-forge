import { DEFAULT_CHIP_SIZE } from '../project/bridge'
import type { OrientedBox, SceneTarget } from '../render/targets'
import { OFFSET_LIMIT } from '../types'
import type { Offset, SceneElement, Screen, Settings } from '../types'

/**
 * The editor's direct manipulation, as pure functions: pointer → scene pixels, what a click hits,
 * and what a drag, a corner pull or a turn writes. The component (`components/CanvasEditor.tsx`)
 * only wires pointer events to these; everything here is unit-tested.
 *
 * Units: "scene pixels" are the renderer's own units for the preview — `renderScene` draws the
 * preview at its CSS size (the device pixel ratio only scales the backing store), so one scene
 * pixel is one CSS pixel of the unscaled preview. The data model stores fractions: `x`/`dx` of the
 * composition width `W` (tile × span), `y`/`dy` of the tile height `h`.
 */

export type Pt = { x: number; y: number }
export type Rect = { left: number; top: number; width: number; height: number }

/** Magnet reach, a fraction of the tile width (x) or height (y). */
export const SNAP_TOLERANCE = 0.01
/** Pointer travel, in CSS pixels, below which a press stays a click and edits nothing. */
export const DRAG_THRESHOLD = 3
/** One arrow-key step, and the Shift step, as fractions of the tile. */
export const NUDGE = 0.005
export const NUDGE_BIG = 0.05
/** Shift while turning rests on multiples of this many degrees. */
export const ROTATE_STEP = 15
/** The ranges the Adjust sliders offer; the canvas handles stop at the same limits. */
export const TILT_LIMIT = 15
export const DEVICE_SCALE_RANGE = { min: 0.7, max: 1.2 }
/**
 * The element ranges the Stickers panel's sliders offer (`components/tune/StickersSection.tsx`);
 * a drag, a corner pull, a turn and an arrow key stop at the same limits, so a slider can always
 * show what the canvas wrote. `validateProject` is deliberately looser: a hand-written value
 * outside them stays valid, the controls just never produce one.
 *
 * Width in tile widths — 2 spans a whole panorama.
 */
export const ELEMENT_WIDTH_RANGE = { min: 0.02, max: 2 }
/** A chip's font size (fraction of the tile height) — inside `validateProject`'s (0.005, 0.2]. The
 *  top end is for the landscape banner, whose tile is short: its headline alone is 0.2 of it. */
export const CHIP_SIZE_RANGE = { min: 0.01, max: 0.2 }
/** An element's centre, `x` of the composition width and `y` of the tile height: a fifth past
 *  every edge, enough for a sticker to peek in from off the tile. */
export const ELEMENT_POSITION_RANGE = { min: -0.2, max: 1.2 }
/** A turn is normalised into (−180, 180], so the Rotate slider spans the whole circle. */
export const ELEMENT_ROTATE_LIMIT = 180

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
/** Four decimals: 0.0001 of a 2640 px panorama is a quarter pixel, and the file stays readable. */
export const round4 = (v: number) => Math.round(v * 10000) / 10000 + 0
const round2 = (v: number) => Math.round(v * 100) / 100 + 0

/** `x +3.0 · y −1.5 %` — an offset as stored, in percent of the composition width / tile height. */
export function formatOffset(o: Offset): string {
  const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}`
  return `x ${pct(o.dx)} · y ${pct(o.dy)} %`
}

/** Client (CSS) coordinates → scene pixels. Only the canvas's on-screen rect matters: its backing
 *  store may be 2× or 3× denser (devicePixelRatio), but the scene is drawn in CSS units. */
export function clientToScene(client: Pt, rect: Rect, sceneW: number, sceneH: number): Pt {
  return {
    x: ((client.x - rect.left) * sceneW) / rect.width,
    y: ((client.y - rect.top) * sceneH) / rect.height,
  }
}

/** Scene pixels → the fractions the data model stores. `W` is the composition width. */
export const toFraction = (p: Pt, W: number, h: number): Pt => ({ x: p.x / W, y: p.y / h })

/** Whether `p` lies inside `box` (turned about its centre), grown by `pad` on every side. */
export function pointInBox(p: Pt, box: OrientedBox, pad = 0): boolean {
  const rad = (-box.angle * Math.PI) / 180
  const dx = p.x - box.cx
  const dy = p.y - box.cy
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
  return Math.abs(lx) <= box.w / 2 + pad && Math.abs(ly) <= box.h / 2 + pad
}

/** The topmost target under `p`. `targets` come bottom first (`sceneTargets`' draw order), so the
 *  search runs backwards — what was drawn last is what the eye sees, and what a click takes. */
export function hitTest(p: Pt, targets: SceneTarget[], pad = 0): SceneTarget | null {
  for (let i = targets.length - 1; i >= 0; i--) {
    if (targets[i].parts.some((part) => pointInBox(p, part, pad))) return targets[i]
  }
  return null
}

export type HandleKind = 'scale' | 'rotate'
export type Handles = { scale?: Pt; rotate?: Pt; stem?: Pt }

/** Which handles a target offers: an element scales and (unless it is a circle or ring) turns; the
 *  arrangement scales (not the mosaic grid) and turns; the copy only moves. */
export function handleKinds(t: SceneTarget): HandleKind[] {
  if (t.kind === 'element') return t.rotatable ? ['scale', 'rotate'] : ['scale']
  if (t.kind === 'device') return t.scalable ? ['scale', 'rotate'] : ['rotate']
  return []
}

/**
 * Where a target's handles sit, in scene pixels: scale on the frame's bottom-right corner, rotate
 * `arm` pixels beyond the middle of its top edge (`stem` is where that edge is), both in the
 * frame's own turned axes. Each is then pulled inside the canvas by `inset` — a hero device runs
 * off the bottom, and a handle nobody can reach is no handle.
 */
export function handlePositions(
  t: SceneTarget,
  sceneW: number,
  sceneH: number,
  arm: number,
  inset: number,
): Handles {
  const kinds = handleKinds(t)
  const f = t.frame
  const rad = (f.angle * Math.PI) / 180
  const at = (lx: number, ly: number): Pt => ({
    x: clamp(f.cx + lx * Math.cos(rad) - ly * Math.sin(rad), inset, sceneW - inset),
    y: clamp(f.cy + lx * Math.sin(rad) + ly * Math.cos(rad), inset, sceneH - inset),
  })
  const handles: Handles = {}
  if (kinds.includes('scale')) handles.scale = at(f.w / 2, f.h / 2)
  if (kinds.includes('rotate')) {
    handles.rotate = at(0, -f.h / 2 - arm)
    handles.stem = at(0, -f.h / 2)
  }
  return handles
}

/** The lines a moving centre is pulled onto: the middle of every tile and, on a panorama, the seam
 *  between them (x); the middle of the tile height (y). Scene pixels. */
export function snapLines(w: number, h: number, span: number): { xs: number[]; ys: number[] } {
  const xs: number[] = []
  for (let i = 1; i < span * 2; i++) xs.push((w * i) / 2)
  return { xs, ys: [h / 2] }
}

export type GuideKind = 'centre' | 'home'
export type Guide = { at: number; kind: GuideKind }
export type Guides = { x?: Guide; y?: Guide }

function snapAxis(v: number, lines: Guide[], tolerance: number): { v: number; guide?: Guide } {
  let best: Guide | undefined
  for (const line of lines) {
    const distance = Math.abs(line.at - v)
    if (distance <= tolerance && (!best || distance < Math.abs(best.at - v))) best = line
  }
  return best ? { v: best.at, guide: best } : { v }
}

/**
 * Pulls a centre onto the nearest line within `SNAP_TOLERANCE` of the tile, per axis. Besides the
 * tile's own middle lines, `home` — where the part sat before the gesture, and for a device or the
 * copy also where the layout alone puts it — is a line too: dragging away and back lands exactly
 * where it started, so a round trip writes nothing.
 */
export function snapCentre(
  centre: Pt,
  w: number,
  h: number,
  span: number,
  home: Pt[],
): { centre: Pt; guides: Guides } {
  const { xs, ys } = snapLines(w, h, span)
  const x = snapAxis(
    centre.x,
    [
      ...xs.map((at) => ({ at, kind: 'centre' as const })),
      ...home.map((p) => ({ at: p.x, kind: 'home' as const })),
    ],
    SNAP_TOLERANCE * w,
  )
  const y = snapAxis(
    centre.y,
    [
      ...ys.map((at) => ({ at, kind: 'centre' as const })),
      ...home.map((p) => ({ at: p.y, kind: 'home' as const })),
    ],
    SNAP_TOLERANCE * h,
  )
  return { centre: { x: x.v, y: y.v }, guides: { x: x.guide, y: y.guide } }
}

/** Degrees the pointer turned about `pivot` between `from` and `to`, clockwise positive, the
 *  short way round (-180, 180]. */
export function turnedBy(pivot: Pt, from: Pt, to: Pt): number {
  const a = Math.atan2(from.y - pivot.y, from.x - pivot.x)
  const b = Math.atan2(to.y - pivot.y, to.x - pivot.x)
  return normalizeAngle(((b - a) * 180) / Math.PI)
}

/** (-180, 180] */
export function normalizeAngle(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180
  return d === -180 ? 180 : d + 0
}

/** Whole degrees, or with `step` the nearest multiple of it (Shift). */
export const snapAngle = (deg: number, step?: number) =>
  step ? Math.round(deg / step) * step + 0 : Math.round(deg) + 0

/** How far a corner pull has grown or shrunk the part: pointer distance to the pivot now, over then. */
export function scaleFactor(pivot: Pt, from: Pt, to: Pt): number {
  const d0 = Math.hypot(from.x - pivot.x, from.y - pivot.y)
  return d0 < 1e-6 ? 1 : Math.hypot(to.x - pivot.x, to.y - pivot.y) / d0
}

export type ElementFields = { x?: number; y?: number; width?: number; rotate?: number; size?: number }
/** The overridable keys the canvas writes. A key present with `undefined` means "drop the
 *  override" — see `resolveOverrides`. */
export type CanvasOverrides = {
  deviceOffset?: Offset
  textOffset?: Offset
  tilt?: number
  deviceScale?: number
}
export type CanvasEdit =
  { kind: 'element'; id: string; fields: ElementFields } | { kind: 'settings'; fields: CanvasOverrides }

export type GestureMode = 'move' | 'scale' | 'rotate'

/** Everything a gesture needs from the moment it began; `effective` is the tile's resolved
 *  settings then, `element` the grabbed element as the renderer saw it. */
export type Gesture = {
  mode: GestureMode
  target: SceneTarget
  origin: Pt
  effective: Settings
  element?: SceneElement
}

export type Modifiers = { shift?: boolean; alt?: boolean }
export type Dims = { w: number; h: number; span: number }

const ZERO: Offset = { dx: 0, dy: 0 }
const offsetOf = (effective: Settings, target: 'device' | 'text') =>
  (target === 'device' ? effective.deviceOffset : effective.textOffset) ?? ZERO
const placeElement = (x: number, y: number): ElementFields => ({
  x: clamp(round4(x), ELEMENT_POSITION_RANGE.min, ELEMENT_POSITION_RANGE.max),
  y: clamp(round4(y), ELEMENT_POSITION_RANGE.min, ELEMENT_POSITION_RANGE.max),
})
const limitOffset = (dx: number, dy: number): Offset => ({
  dx: clamp(round4(dx), -OFFSET_LIMIT, OFFSET_LIMIT),
  dy: clamp(round4(dy), -OFFSET_LIMIT, OFFSET_LIMIT),
})

/**
 * What the gesture writes with the pointer at `pointer`: absolute new values for exactly the
 * fields this mode touches, plus the snap guides to show. Pure — called on every pointer move for
 * the live preview, and once more at the end for the one commit.
 */
export function gestureEdit(
  g: Gesture,
  pointer: Pt,
  mods: Modifiers,
  { w, h, span }: Dims,
): { edit: CanvasEdit; guides: Guides } {
  const W = w * span
  const t = g.target
  const pivot = { x: t.frame.cx, y: t.frame.cy }

  if (g.mode === 'move') {
    const moved = { x: pivot.x + pointer.x - g.origin.x, y: pivot.y + pointer.y - g.origin.y }
    const home = [pivot]
    if (t.kind !== 'element') {
      const off = offsetOf(g.effective, t.kind)
      home.push({ x: pivot.x - off.dx * W, y: pivot.y - off.dy * h })
    }
    const snapped = mods.alt ? { centre: moved, guides: {} } : snapCentre(moved, w, h, span, home)
    const ddx = (snapped.centre.x - pivot.x) / W
    const ddy = (snapped.centre.y - pivot.y) / h
    if (t.kind === 'element') {
      const el = g.element!
      return {
        edit: { kind: 'element', id: t.id, fields: placeElement(el.x + ddx, el.y + ddy) },
        guides: snapped.guides,
      }
    }
    const off = offsetOf(g.effective, t.kind)
    const next = limitOffset(off.dx + ddx, off.dy + ddy)
    const fields: CanvasOverrides = t.kind === 'device' ? { deviceOffset: next } : { textOffset: next }
    return { edit: { kind: 'settings', fields }, guides: snapped.guides }
  }

  if (g.mode === 'scale') {
    const f = scaleFactor(pivot, g.origin, pointer)
    if (t.kind === 'element') {
      const el = g.element!
      const size = 'size' in el ? el.size : undefined
      // One factor for width and (a chip's) font size, clamped so neither leaves its range —
      // clamping them separately would bend the aspect the pull is meant to keep.
      let lo = ELEMENT_WIDTH_RANGE.min / el.width
      let hi = ELEMENT_WIDTH_RANGE.max / el.width
      if (size !== undefined) {
        lo = Math.max(lo, CHIP_SIZE_RANGE.min / size)
        hi = Math.min(hi, CHIP_SIZE_RANGE.max / size)
      }
      const k = clamp(f, lo, hi)
      const fields: ElementFields = { width: round4(el.width * k) }
      if (size !== undefined) fields.size = round4(size * k)
      return { edit: { kind: 'element', id: t.id, fields }, guides: {} }
    }
    const scale = clamp(round2(g.effective.deviceScale * f), DEVICE_SCALE_RANGE.min, DEVICE_SCALE_RANGE.max)
    return { edit: { kind: 'settings', fields: { deviceScale: scale } }, guides: {} }
  }

  const turned = turnedBy(pivot, g.origin, pointer)
  const step = mods.shift ? ROTATE_STEP : undefined
  if (t.kind === 'element') {
    const rotate = normalizeAngle(snapAngle(g.element!.rotate + turned, step))
    return { edit: { kind: 'element', id: t.id, fields: { rotate } }, guides: {} }
  }
  const tilt = clamp(snapAngle(g.effective.tilt + turned, step), -TILT_LIMIT, TILT_LIMIT)
  return { edit: { kind: 'settings', fields: { tilt } }, guides: {} }
}

/**
 * One press-drag-release on the canvas, start to finish. Waits out `DRAG_THRESHOLD` (a press that
 * never travels that far is a click and edits nothing), keeps the last live edit, and after
 * `cancel` — Escape, Undo mid-drag, a lost pointer — ends with nothing at all. The component only
 * feeds it pointer positions; what reaches the store is `end`'s one edit.
 */
export class GestureSession {
  readonly gesture: Gesture
  readonly pointerId: number
  private readonly client0: Pt
  private started = false
  private cancelled = false
  private last: CanvasEdit | null = null
  /** What the gesture writes with the pointer back on its origin: the values it started from, at
   *  the precision and within the limits it writes them. */
  private home: CanvasEdit | null = null

  constructor(gesture: Gesture, pointerId: number, client0: Pt) {
    this.gesture = gesture
    this.pointerId = pointerId
    this.client0 = client0
  }

  /** The live edit with the pointer at `client` (CSS) / `scene`, or null while it is still a click. */
  move(client: Pt, scene: Pt, mods: Modifiers, dims: Dims): { edit: CanvasEdit; guides: Guides } | null {
    if (this.cancelled) return null
    if (!this.started) {
      if (Math.hypot(client.x - this.client0.x, client.y - this.client0.y) < DRAG_THRESHOLD) return null
      this.started = true
      this.home = gestureEdit(this.gesture, this.gesture.origin, {}, dims).edit
    }
    const result = gestureEdit(this.gesture, scene, mods, dims)
    this.last = result.edit
    return result
  }

  cancel() {
    this.cancelled = true
    this.last = null
  }

  /**
   * What letting go writes: the last live edit, overrides resolved against the set-wide
   * `inherited` settings (`resolveOverrides`). Null for a click, after `cancel`, and when the
   * gesture ended on the values it started from — judged before resolving, because a pin that
   * merely repeats the global resolves to "drop it", which would be a write (rules.md #9).
   */
  end(inherited: Settings): CanvasEdit | null {
    if (this.cancelled || !this.started || !this.last) return null
    const edit = this.last
    // Both come out of `gestureEdit` for the same gesture: same keys in the same order.
    if (JSON.stringify(edit) === JSON.stringify(this.home)) return null
    return edit.kind === 'settings'
      ? { kind: 'settings', fields: resolveOverrides(edit.fields, inherited) }
      : edit
  }
}

/** One arrow-key step for the selected part: `NUDGE` of the tile, `NUDGE_BIG` with Shift. */
export function nudgeEdit(
  t: SceneTarget,
  effective: Settings,
  element: SceneElement | undefined,
  dir: Pt,
  big: boolean,
  { span }: Pick<Dims, 'span'>,
): CanvasEdit {
  const step = big ? NUDGE_BIG : NUDGE
  // `x`/`dx` count in composition widths; a step is a fraction of one tile.
  const ddx = (dir.x * step) / span
  const ddy = dir.y * step
  if (t.kind === 'element')
    return { kind: 'element', id: t.id, fields: placeElement(element!.x + ddx, element!.y + ddy) }
  const off = offsetOf(effective, t.kind)
  const next = limitOffset(off.dx + ddx, off.dy + ddy)
  return { kind: 'settings', fields: t.kind === 'device' ? { deviceOffset: next } : { textOffset: next } }
}

/** The screen as the preview should draw it mid-gesture: the edit's values laid over it, nothing
 *  else touched. The same values the commit writes, so letting go changes no pixel. */
export function screenWithEdit(screen: Screen, edit: CanvasEdit): Screen {
  if (edit.kind === 'settings') return { ...screen, overrides: { ...screen.overrides, ...edit.fields } }
  return {
    ...screen,
    elements: screen.elements?.map((el) =>
      el.id === edit.id ? ({ ...el, ...edit.fields } as SceneElement) : el,
    ),
  }
}

const sameOffset = (a: Offset | undefined, b: Offset | undefined) =>
  (a ?? ZERO).dx === (b ?? ZERO).dx && (a ?? ZERO).dy === (b ?? ZERO).dy

/**
 * Turns a gesture's absolute values into override writes against what the tile would otherwise
 * inherit (`inherited`, the set-wide settings): a value equal to the inherited one becomes
 * `undefined` — drop the override, never pin a copy of the global (rules.md #8). For an offset
 * that also means a 0/0 with nothing set-wide never reaches the file.
 */
export function resolveOverrides(fields: CanvasOverrides, inherited: Settings): CanvasOverrides {
  const out: CanvasOverrides = {}
  if ('deviceOffset' in fields)
    out.deviceOffset = sameOffset(fields.deviceOffset, inherited.deviceOffset)
      ? undefined
      : fields.deviceOffset
  if ('textOffset' in fields)
    out.textOffset = sameOffset(fields.textOffset, inherited.textOffset) ? undefined : fields.textOffset
  if ('tilt' in fields) out.tilt = fields.tilt === inherited.tilt ? undefined : fields.tilt
  if ('deviceScale' in fields)
    out.deviceScale = fields.deviceScale === inherited.deviceScale ? undefined : fields.deviceScale
  return out
}

/** The element fields that actually differ from `el` as stored, with a value equal to its own
 *  default (`rotate` 0, a chip's `size`) dropped rather than written — `undefined` means drop. */
export function changedElementFields(
  el: { x: number; y: number; width: number; rotate?: number; size?: number; chip?: true },
  fields: ElementFields,
): ElementFields | null {
  const out: ElementFields = {}
  let changed = false
  for (const key of ['x', 'y', 'width'] as const) {
    if (fields[key] !== undefined && fields[key] !== el[key]) {
      out[key] = fields[key]
      changed = true
    }
  }
  if (fields.rotate !== undefined && fields.rotate !== (el.rotate ?? 0)) {
    out.rotate = fields.rotate === 0 ? undefined : fields.rotate
    changed = true
  }
  if (el.chip && fields.size !== undefined && fields.size !== (el.size ?? DEFAULT_CHIP_SIZE)) {
    out.size = fields.size === DEFAULT_CHIP_SIZE ? undefined : fields.size
    changed = true
  }
  return changed ? out : null
}
