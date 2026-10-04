import { describe, expect, it } from 'vitest'
import {
  CHIP_SIZE_RANGE,
  DEVICE_SCALE_RANGE,
  DRAG_THRESHOLD,
  ELEMENT_POSITION_RANGE,
  ELEMENT_ROTATE_LIMIT,
  ELEMENT_WIDTH_RANGE,
  GestureSession,
  NUDGE,
  NUDGE_BIG,
  SNAP_TOLERANCE,
  TILT_LIMIT,
  changedElementFields,
  clientToScene,
  formatOffset,
  gestureEdit,
  handleKinds,
  handlePositions,
  hitTest,
  normalizeAngle,
  nudgeEdit,
  pointInBox,
  resolveOverrides,
  scaleFactor,
  screenWithEdit,
  snapAngle,
  snapCentre,
  snapLines,
  toFraction,
  turnedBy,
  type Gesture,
} from './canvasEdit'
import { DEFAULT_SETTINGS } from '../store'
import type { OrientedBox, SceneTarget } from '../render/targets'
import { OFFSET_LIMIT, turnsVisibly } from '../types'
import type { ChipElement, Screen, Settings, StickerElement } from '../types'

/** A 210 px wide preview of a 1320 × 2868 store tile — the Screenshots step's card. */
const TILE = { w: 210, h: 456 }
const EXPORT = { w: 1320, h: 2868 }

const box = (cx: number, cy: number, w: number, h: number, angle = 0): OrientedBox => ({
  cx,
  cy,
  w,
  h,
  angle,
})
const elementTarget = (id: string, frame: OrientedBox, rotatable = true): SceneTarget => ({
  kind: 'element',
  id,
  frame,
  parts: [frame],
  rotatable,
})

const sticker = (patch: Partial<StickerElement> = {}): StickerElement => ({
  id: 'kevin',
  imageId: 'artwork/en/kevin',
  x: 0.5,
  y: 0.5,
  width: 0.3,
  rotate: 0,
  layer: 'front',
  shadow: false,
  ...patch,
})

const chip = (patch: Partial<ChipElement> = {}): ChipElement => ({
  id: 'chip',
  text: '+312 €',
  size: 0.026,
  x: 0.3,
  y: 0.4,
  width: 0.5,
  rotate: 0,
  layer: 'front',
  shadow: false,
  ...patch,
})

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

/** A gesture on an element whose frame is centred where the element's own x/y put it. */
const onElement = (
  mode: Gesture['mode'],
  el: StickerElement | ChipElement,
  span = 1,
  frameW = 40,
): Gesture => {
  const W = TILE.w * span
  return {
    mode,
    target: elementTarget(el.id, box(el.x * W, el.y * TILE.h, frameW, frameW, el.rotate)),
    origin: { x: el.x * W, y: el.y * TILE.h },
    effective: settings(),
    element: el,
  }
}

const onDevice = (mode: Gesture['mode'], effective: Settings, frame = box(105, 300, 120, 250)): Gesture => ({
  mode,
  target: { kind: 'device', frame, parts: [frame], scalable: true },
  origin: { x: frame.cx, y: frame.cy },
  effective,
})

const onText = (effective: Settings, frame = box(105, 60, 160, 50)): Gesture => ({
  mode: 'move',
  target: { kind: 'text', frame, parts: [frame] },
  origin: { x: frame.cx, y: frame.cy },
  effective,
})

const dims = (span = 1) => ({ w: TILE.w, h: TILE.h, span })

describe('clientToScene', () => {
  it('maps a CSS pixel inside the preview to the same scene pixel', () => {
    const rect = { left: 593, top: 166, width: 210, height: 456 }
    expect(clientToScene({ x: 593 + 42, y: 166 + 100 }, rect, 210, 456)).toEqual({ x: 42, y: 100 })
  })

  it('never depends on the backing store: every devicePixelRatio gives the same export pixel', () => {
    // The preview canvas is `fullWidth × dpr` backing pixels but always `fullWidth` CSS pixels wide;
    // only the CSS rect enters the mapping, so a drag means the same distance at every density.
    const results = [1, 1.5, 2, 3].map((dpr) => {
      const backing = { w: Math.round(TILE.w * dpr), h: Math.round(TILE.h * dpr) }
      expect(backing.w).toBeGreaterThan(0)
      const rect = { left: 10, top: 20, width: TILE.w, height: TILE.h }
      const p = clientToScene({ x: 10 + 21, y: 20 + 45.6 }, rect, TILE.w, TILE.h)
      const f = toFraction(p, TILE.w, TILE.h)
      return { x: f.x * EXPORT.w, y: f.y * EXPORT.h }
    })
    for (const r of results) {
      expect(r.x).toBeCloseTo(132, 9)
      expect(r.y).toBeCloseTo(286.8, 9)
    }
  })

  it('undoes a CSS-scaled preview', () => {
    const rect = { left: 0, top: 0, width: 420, height: 912 }
    expect(clientToScene({ x: 210, y: 456 }, rect, 210, 456)).toEqual({ x: 105, y: 228 })
  })

  it('spans both tiles of a panorama: the right tile starts at one tile width', () => {
    const rect = { left: 0, top: 0, width: 420, height: 456 }
    const p = clientToScene({ x: 315, y: 0 }, rect, 420, 456)
    expect(p.x).toBe(315)
    // As a fraction of the composition width, like a sticker's x on a panorama.
    expect(toFraction(p, 420, 456).x).toBeCloseTo(0.75, 12)
  })
})

describe('pointInBox', () => {
  it('contains its centre and edges, not beyond', () => {
    const b = box(100, 100, 40, 20)
    expect(pointInBox({ x: 100, y: 100 }, b)).toBe(true)
    expect(pointInBox({ x: 120, y: 110 }, b)).toBe(true)
    expect(pointInBox({ x: 121, y: 100 }, b)).toBe(false)
    expect(pointInBox({ x: 100, y: 111 }, b)).toBe(false)
  })

  it('turns with the box: a quarter turn swaps its extents', () => {
    const b = box(100, 100, 40, 20, 90)
    expect(pointInBox({ x: 100, y: 118 }, b)).toBe(true)
    expect(pointInBox({ x: 118, y: 100 }, b)).toBe(false)
  })

  it('misses the corner of an axis box once it is turned 45°', () => {
    const b = box(0, 0, 20, 20, 45)
    expect(pointInBox({ x: 9, y: 9 }, box(0, 0, 20, 20))).toBe(true)
    expect(pointInBox({ x: 9, y: 9 }, b)).toBe(false)
    expect(pointInBox({ x: 0, y: 14 }, b)).toBe(true)
  })

  it('grows by pad', () => {
    expect(pointInBox({ x: 122, y: 100 }, box(100, 100, 40, 20), 2)).toBe(true)
  })
})

describe('hitTest', () => {
  const behind = elementTarget('behind', box(100, 100, 100, 100))
  const front = elementTarget('front', box(100, 100, 20, 20))

  it('takes the part drawn last, the one the eye sees', () => {
    expect(hitTest({ x: 100, y: 100 }, [behind, front])).toBe(front)
    expect(hitTest({ x: 100, y: 100 }, [front, behind])).toBe(behind)
  })

  it('falls through to what lies underneath', () => {
    expect(hitTest({ x: 140, y: 140 }, [behind, front])).toBe(behind)
    expect(hitTest({ x: 300, y: 300 }, [behind, front])).toBeNull()
  })

  it('hits a turned part only inside its turned outline', () => {
    const turned = elementTarget('t', box(0, 0, 20, 20, 45))
    expect(hitTest({ x: 9, y: 9 }, [turned])).toBeNull()
    expect(hitTest({ x: 0, y: 13 }, [turned])).toBe(turned)
  })

  it('hits a multi-device arrangement on each device, not in the gap between them', () => {
    const left = box(50, 100, 40, 80)
    const right = box(150, 100, 40, 80)
    const device: SceneTarget = {
      kind: 'device',
      frame: box(100, 100, 140, 80),
      parts: [left, right],
      scalable: true,
    }
    expect(hitTest({ x: 50, y: 100 }, [device])).toBe(device)
    expect(hitTest({ x: 100, y: 100 }, [device])).toBeNull()
  })
})

describe('handles', () => {
  it('an element scales and turns; a circle only scales; the copy has none', () => {
    expect(handleKinds(elementTarget('a', box(0, 0, 1, 1)))).toEqual(['scale', 'rotate'])
    expect(handleKinds(elementTarget('a', box(0, 0, 1, 1), false))).toEqual(['scale'])
    const f = box(0, 0, 1, 1)
    expect(handleKinds({ kind: 'text', frame: f, parts: [f] })).toEqual([])
    expect(handleKinds({ kind: 'device', frame: f, parts: [f], scalable: false })).toEqual(['rotate'])
  })

  it('puts scale on the bottom-right corner and rotate above the top edge, in the turned frame', () => {
    const h = handlePositions(elementTarget('a', box(100, 100, 40, 20)), 210, 456, 20, 0)
    expect(h.scale).toEqual({ x: 120, y: 110 })
    expect(h.stem).toEqual({ x: 100, y: 90 })
    expect(h.rotate).toEqual({ x: 100, y: 70 })
    const turned = handlePositions(elementTarget('a', box(100, 100, 40, 20, 90)), 210, 456, 20, 0)
    expect(turned.rotate!.x).toBeCloseTo(130, 9)
    expect(turned.rotate!.y).toBeCloseTo(100, 9)
  })

  it('turns what shows a turn — the canvas’s handle and the panel’s Rotate slider ask the same', () => {
    const shape = (kind: 'circle' | 'ring' | 'blob') => ({
      id: 's',
      shape: kind,
      color: '#fff',
      x: 0,
      y: 0,
      width: 1,
    })
    expect(turnsVisibly(shape('blob'))).toBe(true)
    expect(turnsVisibly(shape('circle'))).toBe(false)
    expect(turnsVisibly(shape('ring'))).toBe(false)
    expect(turnsVisibly(sticker())).toBe(true)
    expect(turnsVisibly(chip())).toBe(true)
    expect(turnsVisibly({ id: 'k', artwork: 'kevin', x: 0, y: 0, width: 1 })).toBe(true)
  })

  it('pulls a handle of a part that runs off the canvas back inside it', () => {
    const hero: SceneTarget = {
      kind: 'device',
      frame: box(105, 400, 200, 300),
      parts: [box(105, 400, 200, 300)],
      scalable: true,
    }
    const h = handlePositions(hero, 210, 456, 20, 6)
    expect(h.scale).toEqual({ x: 204, y: 450 })
  })
})

describe('snapping', () => {
  it('offers the tile middle, and on a panorama both middles and the seam', () => {
    expect(snapLines(210, 456, 1)).toEqual({ xs: [105], ys: [228] })
    expect(snapLines(210, 456, 2)).toEqual({ xs: [105, 210, 315], ys: [228] })
  })

  it('pulls a centre within 1 % of the tile onto the middle line and names the guide', () => {
    const tol = SNAP_TOLERANCE * TILE.w
    const { centre, guides } = snapCentre({ x: 105 + tol * 0.9, y: 300 }, TILE.w, TILE.h, 1, [])
    expect(centre.x).toBe(105)
    expect(guides.x).toEqual({ at: 105, kind: 'centre' })
    expect(guides.y).toBeUndefined()
  })

  it('leaves a centre alone beyond the magnet', () => {
    const tol = SNAP_TOLERANCE * TILE.w
    const { centre, guides } = snapCentre({ x: 105 + tol * 1.1, y: 300 }, TILE.w, TILE.h, 1, [])
    expect(centre.x).toBeCloseTo(105 + tol * 1.1, 12)
    expect(guides).toEqual({ x: undefined, y: undefined })
  })

  it('reaches the vertical middle with its own, height-based magnet', () => {
    const { centre, guides } = snapCentre({ x: 40, y: 228 + 4 }, TILE.w, TILE.h, 1, [])
    expect(centre.y).toBe(228)
    expect(guides.y?.kind).toBe('centre')
  })

  it('snaps to the seam of a panorama', () => {
    const { centre } = snapCentre({ x: 211, y: 50 }, TILE.w, TILE.h, 2, [])
    expect(centre.x).toBe(210)
  })

  it('treats where the part started as a line too, so a round trip lands exactly home', () => {
    const { centre, guides } = snapCentre({ x: 60.8, y: 330.5 }, TILE.w, TILE.h, 1, [{ x: 60, y: 331 }])
    expect(centre).toEqual({ x: 60, y: 331 })
    expect(guides.x?.kind).toBe('home')
    expect(guides.y?.kind).toBe('home')
  })

  it('prefers the nearer line when two are in reach', () => {
    const { centre } = snapCentre({ x: 106, y: 0 }, TILE.w, TILE.h, 1, [{ x: 107.5, y: 999 }])
    expect(centre.x).toBe(105)
  })
})

describe('angles and scale', () => {
  it('measures a clockwise turn about the pivot as positive', () => {
    expect(turnedBy({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90, 9)
    expect(turnedBy({ x: 0, y: 0 }, { x: 0, y: -10 }, { x: -10, y: 0 })).toBeCloseTo(-90, 9)
  })

  it('normalises into (-180, 180]', () => {
    expect(normalizeAngle(190)).toBe(-170)
    expect(normalizeAngle(-180)).toBe(180)
    expect(normalizeAngle(360)).toBe(0)
    expect(Object.is(normalizeAngle(-360), -0)).toBe(false)
  })

  it('rounds to whole degrees, or to the step with Shift', () => {
    expect(snapAngle(12.4)).toBe(12)
    expect(snapAngle(22.6, 15)).toBe(30)
    expect(snapAngle(-7, 15)).toBe(0)
    expect(Object.is(snapAngle(-7, 15), -0)).toBe(false)
  })

  it('scales by the ratio of the pointer distances to the pivot', () => {
    expect(scaleFactor({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 })).toBe(2)
    expect(scaleFactor({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 })).toBe(1)
  })
})

describe('gestureEdit: move', () => {
  it('turns a preview drag into the element fraction the export places it at', () => {
    const el = sticker({ x: 0.5, y: 0.5 })
    const g = onElement('move', el)
    const { edit } = gestureEdit(g, { x: g.origin.x + 42, y: g.origin.y - 45.6 }, {}, dims())
    expect(edit).toEqual({ kind: 'element', id: 'kevin', fields: { x: 0.7, y: 0.4 } })
    // 42 CSS px of a 210 px preview is 264 px of the 1320 px export.
    expect(((edit.fields as { x: number }).x - 0.5) * EXPORT.w).toBeCloseTo(264, 9)
  })

  it('counts x in composition widths on a panorama', () => {
    const el = sticker({ x: 0.5, y: 0.5 })
    const g = onElement('move', el, 2)
    const { edit } = gestureEdit(g, { x: g.origin.x + 42, y: g.origin.y }, {}, dims(2))
    expect(edit.fields).toEqual({ x: 0.6, y: 0.5 })
  })

  it('snaps the element centre to the tile middle, with a guide', () => {
    const el = sticker({ x: 0.3, y: 0.3 })
    const g = onElement('move', el)
    const { edit, guides } = gestureEdit(g, { x: 105 + 1, y: g.origin.y + 20 }, {}, dims())
    expect((edit.fields as { x: number }).x).toBe(0.5)
    expect(guides.x).toEqual({ at: 105, kind: 'centre' })
  })

  it('does not snap with Alt', () => {
    const el = sticker({ x: 0.3, y: 0.3 })
    const g = onElement('move', el)
    const { edit, guides } = gestureEdit(g, { x: 105 + 1, y: g.origin.y + 20 }, { alt: true }, dims())
    expect((edit.fields as { x: number }).x).toBe(0.5048)
    expect(guides).toEqual({})
  })

  it('stops an element at the X/Y sliders’ range, a drag and an arrow key alike', () => {
    const g = onElement('move', sticker({ x: 1.1, y: -0.1 }))
    const { edit } = gestureEdit(g, { x: g.origin.x + 500, y: g.origin.y - 500 }, {}, dims())
    expect(edit.fields).toEqual({ x: ELEMENT_POSITION_RANGE.max, y: ELEMENT_POSITION_RANGE.min })
    const t = elementTarget('kevin', box(0, 0, 1, 1))
    const edge = sticker({ x: ELEMENT_POSITION_RANGE.max - 0.01, y: ELEMENT_POSITION_RANGE.min + 0.01 })
    expect(nudgeEdit(t, settings(), edge, { x: 1, y: -1 }, true, { span: 1 })!.fields).toEqual({
      x: ELEMENT_POSITION_RANGE.max,
      y: ELEMENT_POSITION_RANGE.min,
    })
    const atEdge = sticker({ x: ELEMENT_POSITION_RANGE.max, y: ELEMENT_POSITION_RANGE.min })
    expect(nudgeEdit(t, settings(), atEdge, { x: 1, y: -1 }, true, { span: 1 })).toBeNull()
  })

  it('adds a device drag to the offset it already had', () => {
    const g = onDevice('move', settings({ deviceOffset: { dx: 0.1, dy: 0 } }))
    const { edit } = gestureEdit(g, { x: g.origin.x + 21, y: g.origin.y + 45.6 }, {}, dims())
    expect(edit).toEqual({ kind: 'settings', fields: { deviceOffset: { dx: 0.2, dy: 0.1 } } })
  })

  it('pulls a device back onto its layout position — offset 0/0 — near it', () => {
    const g = onDevice('move', settings({ deviceOffset: { dx: 0.1, dy: 0.05 } }))
    // The layout position is 21 px left of and 22.8 px above where the gesture began.
    const { edit, guides } = gestureEdit(g, { x: g.origin.x - 20.5, y: g.origin.y - 23 }, {}, dims())
    expect(edit.fields).toEqual({ deviceOffset: { dx: 0, dy: 0 } })
    expect(guides.x?.kind).toBe('home')
  })

  it('moves the copy through its own offset and stops at one tile either way', () => {
    const g = onText(settings())
    const { edit } = gestureEdit(g, { x: g.origin.x - 500, y: g.origin.y + 10 }, {}, dims())
    expect(edit).toEqual({ kind: 'settings', fields: { textOffset: { dx: -1, dy: 0.0219 } } })
  })
})

describe('gestureEdit: scale', () => {
  it('grows an element from its centre by the pull', () => {
    const el = sticker({ width: 0.3 })
    const g = onElement('scale', el)
    g.origin = { x: g.target.frame.cx + 20, y: g.target.frame.cy + 20 }
    const { edit } = gestureEdit(g, { x: g.target.frame.cx + 30, y: g.target.frame.cy + 30 }, {}, dims())
    expect(edit.fields).toEqual({ width: 0.45 })
  })

  it('scales a chip’s font with its width, so the pill keeps its shape', () => {
    const el = chip({ width: 0.5, size: 0.02 })
    const g = onElement('scale', el)
    g.origin = { x: g.target.frame.cx + 10, y: g.target.frame.cy }
    const { edit } = gestureEdit(g, { x: g.target.frame.cx + 15, y: g.target.frame.cy }, {}, dims())
    expect(edit.fields).toEqual({ width: 0.75, size: 0.03 })
  })

  it('clamps width and size with one factor, never bending the aspect', () => {
    const el = chip({ width: 0.5, size: 0.1 })
    const g = onElement('scale', el)
    g.origin = { x: g.target.frame.cx + 10, y: g.target.frame.cy }
    const { edit } = gestureEdit(g, { x: g.target.frame.cx + 100, y: g.target.frame.cy }, {}, dims())
    const f = edit.fields as { width: number; size: number }
    expect(f.size).toBe(CHIP_SIZE_RANGE.max)
    expect(f.width / f.size).toBeCloseTo(0.5 / 0.1, 9)
    const tiny = gestureEdit(g, { x: g.target.frame.cx + 0.001, y: g.target.frame.cy }, {}, dims())
    expect((tiny.edit.fields as { width: number }).width).toBeGreaterThanOrEqual(ELEMENT_WIDTH_RANGE.min)
  })

  it('writes deviceScale in hundredths, inside the slider range', () => {
    const g = onDevice('scale', settings({ deviceScale: 1 }))
    g.origin = { x: g.target.frame.cx + 100, y: g.target.frame.cy }
    expect(
      gestureEdit(g, { x: g.target.frame.cx + 105.3, y: g.target.frame.cy }, {}, dims()).edit.fields,
    ).toEqual({
      deviceScale: 1.05,
    })
    expect(
      gestureEdit(g, { x: g.target.frame.cx + 500, y: g.target.frame.cy }, {}, dims()).edit.fields,
    ).toEqual({
      deviceScale: DEVICE_SCALE_RANGE.max,
    })
    expect(
      gestureEdit(g, { x: g.target.frame.cx + 1, y: g.target.frame.cy }, {}, dims()).edit.fields,
    ).toEqual({
      deviceScale: DEVICE_SCALE_RANGE.min,
    })
  })
})

describe('gestureEdit: rotate', () => {
  const turn = (g: Gesture, deg: number) => {
    const r = 50
    const a0 = Math.atan2(g.origin.y - g.target.frame.cy, g.origin.x - g.target.frame.cx)
    const a = a0 + (deg * Math.PI) / 180
    return { x: g.target.frame.cx + r * Math.cos(a), y: g.target.frame.cy + r * Math.sin(a) }
  }

  it('turns an element by the pointer’s turn about its centre', () => {
    const g = onElement('rotate', sticker({ rotate: 8 }))
    g.origin = { x: g.target.frame.cx, y: g.target.frame.cy - 40 }
    expect(gestureEdit(g, turn(g, 30.4), {}, dims()).edit.fields).toEqual({ rotate: 38 })
  })

  it('rests on multiples of 15° with Shift, and wraps past a half turn', () => {
    const g = onElement('rotate', sticker({ rotate: 8 }))
    g.origin = { x: g.target.frame.cx, y: g.target.frame.cy - 40 }
    expect(gestureEdit(g, turn(g, 30.4), { shift: true }, dims()).edit.fields).toEqual({ rotate: 45 })
    expect(gestureEdit(g, turn(g, 179), {}, dims()).edit.fields).toEqual({ rotate: -173 })
  })

  it('turns an element only as far as the Rotate slider reaches — every angle, the whole circle', () => {
    const g = onElement('rotate', sticker({ rotate: 170 }))
    g.origin = { x: g.target.frame.cx, y: g.target.frame.cy - 40 }
    for (let deg = -360; deg <= 360; deg += 7.5) {
      const { rotate } = gestureEdit(g, turn(g, deg), {}, dims()).edit.fields as { rotate: number }
      expect(Math.abs(rotate)).toBeLessThanOrEqual(ELEMENT_ROTATE_LIMIT)
    }
    expect(gestureEdit(g, turn(g, 10), {}, dims()).edit.fields).toEqual({ rotate: 180 })
    expect(gestureEdit(g, turn(g, -100), {}, dims()).edit.fields).toEqual({ rotate: 70 })
  })

  it('stops the device tilt at the slider’s limit', () => {
    const g = onDevice('rotate', settings({ tilt: 0 }))
    g.origin = { x: g.target.frame.cx, y: g.target.frame.cy - 100 }
    expect(gestureEdit(g, turn(g, 9.6), {}, dims()).edit.fields).toEqual({ tilt: 10 })
    expect(gestureEdit(g, turn(g, 60), {}, dims()).edit.fields).toEqual({ tilt: TILT_LIMIT })
    expect(gestureEdit(g, turn(g, -60), {}, dims()).edit.fields).toEqual({ tilt: -TILT_LIMIT })
  })
})

describe('GestureSession', () => {
  const session = () => new GestureSession(onDevice('move', settings()), 1, { x: 0, y: 0 })

  it('is a click, and edits nothing, until the pointer travels DRAG_THRESHOLD', () => {
    const s = session()
    expect(s.move({ x: DRAG_THRESHOLD - 1, y: 0 }, { x: 107, y: 300 }, {}, dims())).toBeNull()
    expect(s.end(settings())).toBeNull()
  })

  it('ends with the last live edit, resolved against the set-wide settings', () => {
    const s = session()
    const live = s.move({ x: 30, y: 0 }, { x: 105 + 21, y: 300 }, {}, dims())
    expect(live?.edit.fields).toEqual({ deviceOffset: { dx: 0.1, dy: 0 } })
    expect(s.end(settings())).toEqual({ kind: 'settings', fields: { deviceOffset: { dx: 0.1, dy: 0 } } })
  })

  it('ends with nothing after Escape, however far it went', () => {
    const s = session()
    s.move({ x: 30, y: 0 }, { x: 150, y: 300 }, {}, dims())
    s.cancel()
    expect(s.move({ x: 60, y: 0 }, { x: 180, y: 300 }, {}, dims())).toBeNull()
    expect(s.end(settings())).toBeNull()
  })

  it('ends with nothing when the drag came back home', () => {
    const s = session()
    s.move({ x: 30, y: 0 }, { x: 150, y: 300 }, {}, dims())
    s.move({ x: 1, y: 0 }, { x: 105.4, y: 300.3 }, {}, dims())
    expect(s.end(settings())).toBeNull()
  })

  describe('a gesture that ends where it began writes nothing, whatever the tile pins', () => {
    /** Out `deg` degrees about the frame’s centre and back to within a twentieth of a degree of the start. */
    const turnAndBack = (g: Gesture, deg: number) => {
      g.origin = { x: g.target.frame.cx, y: g.target.frame.cy - 100 }
      const at = (d: number) => {
        const r = (d * Math.PI) / 180
        return { x: g.target.frame.cx + 100 * Math.sin(r), y: g.target.frame.cy - 100 * Math.cos(r) }
      }
      const s = new GestureSession(g, 1, { x: 0, y: 0 })
      s.move({ x: 20, y: 0 }, at(deg), {}, dims())
      s.move({ x: 4, y: 0 }, at(0.05), {}, dims())
      return s
    }
    /** Pulled by `k` and back to the start. */
    const pullAndBack = (g: Gesture, k: number) => {
      g.origin = { x: g.target.frame.cx + 20, y: g.target.frame.cy }
      const s = new GestureSession(g, 1, { x: 0, y: 0 })
      s.move({ x: 20, y: 0 }, { x: g.target.frame.cx + 20 * k, y: g.target.frame.cy }, {}, dims())
      s.move({ x: 4, y: 0 }, g.origin, {}, dims())
      return s
    }
    /** Dragged away and back onto the start, where `home` snaps it. */
    const dragAndBack = (g: Gesture) => {
      const s = new GestureSession(g, 1, { x: 0, y: 0 })
      s.move({ x: 30, y: 0 }, { x: g.origin.x + 40, y: g.origin.y + 30 }, {}, dims())
      s.move({ x: 1, y: 0 }, { x: g.origin.x + 0.4, y: g.origin.y - 0.3 }, {}, dims())
      return s
    }

    // The tile pins the value the set already has: resolving the end would drop that pin, a write.
    it('turning the device', () => {
      const pinned = settings({ tilt: 0 })
      expect(turnAndBack(onDevice('rotate', pinned), 5).end(settings())).toBeNull()
    })

    it('scaling the device', () => {
      const pinned = settings({ deviceScale: 1 })
      expect(pullAndBack(onDevice('scale', pinned), 1.1).end(settings())).toBeNull()
    })

    it('moving the device or the copy', () => {
      const inherited = settings({ deviceOffset: { dx: 0.1, dy: 0 }, textOffset: { dx: 0, dy: 0.2 } })
      expect(dragAndBack(onDevice('move', inherited)).end(inherited)).toBeNull()
      expect(dragAndBack(onText(inherited)).end(inherited)).toBeNull()
    })

    it('moving, scaling or turning an element stored finer than the gesture writes', () => {
      const el = sticker({ x: 0.12345, y: 0.54321, width: 0.33333, rotate: 8.4 })
      expect(dragAndBack(onElement('move', el)).end(settings())).toBeNull()
      expect(pullAndBack(onElement('scale', el), 1.3).end(settings())).toBeNull()
      expect(turnAndBack(onElement('rotate', el), 20).end(settings())).toBeNull()
    })

    it('a value outside the gesture’s own limits is not pulled inside by a round trip', () => {
      const wide = settings({ deviceScale: 1.5 })
      expect(pullAndBack(onDevice('scale', wide), 0.9).end(settings())).toBeNull()
    })

    it('a turn that stays away still writes, resolved as before', () => {
      const g = onDevice('rotate', settings({ tilt: 0 }))
      g.origin = { x: g.target.frame.cx, y: g.target.frame.cy - 100 }
      const s = new GestureSession(g, 1, { x: 0, y: 0 })
      const r = (5 * Math.PI) / 180
      s.move(
        { x: 20, y: 0 },
        { x: g.target.frame.cx + 100 * Math.sin(r), y: g.target.frame.cy - 100 * Math.cos(r) },
        {},
        dims(),
      )
      expect(s.end(settings())).toEqual({ kind: 'settings', fields: { tilt: 5 } })
    })
  })
})

describe('nudgeEdit', () => {
  it('steps an element by half a percent of the tile, five with Shift', () => {
    const t = elementTarget('kevin', box(0, 0, 1, 1))
    const el = sticker({ x: 0.5, y: 0.5 })
    expect(nudgeEdit(t, settings(), el, { x: 1, y: 0 }, false, { span: 1 })!.fields).toEqual({
      x: 0.505,
      y: 0.5,
    })
    expect(nudgeEdit(t, settings(), el, { x: 0, y: -1 }, true, { span: 1 })!.fields).toEqual({
      x: 0.5,
      y: 0.45,
    })
    expect(NUDGE_BIG).toBe(NUDGE * 10)
  })

  it('keeps the step one tile-percent on a panorama, where x counts in composition widths', () => {
    const t = elementTarget('kevin', box(0, 0, 1, 1))
    expect(nudgeEdit(t, settings(), sticker({ x: 0.5 }), { x: 1, y: 0 }, false, { span: 2 })!.fields).toEqual(
      {
        x: 0.5025,
        y: 0.5,
      },
    )
  })

  it('steps the copy through its offset', () => {
    const f = box(0, 0, 1, 1)
    const edit = nudgeEdit(
      { kind: 'text', frame: f, parts: [f] },
      settings(),
      undefined,
      { x: 0, y: 1 },
      false,
      {
        span: 1,
      },
    )
    expect(edit).toEqual({ kind: 'settings', fields: { textOffset: { dx: 0, dy: 0.005 } } })
  })

  it('writes nothing at the offset limit, so a pin equal to the set-wide value is not dropped', () => {
    const f = box(0, 0, 1, 1)
    const t = { kind: 'text' as const, frame: f, parts: [f] }
    const limit = settings({ textOffset: { dx: OFFSET_LIMIT, dy: 0 } })
    expect(nudgeEdit(t, limit, undefined, { x: 1, y: 0 }, true, { span: 1 })).toBeNull()
    expect(nudgeEdit(t, limit, undefined, { x: -1, y: 0 }, false, { span: 1 })).not.toBeNull()
  })
})

describe('screenWithEdit', () => {
  const screen: Screen = {
    id: 'a',
    headline: 'Hi',
    subhead: '',
    imageId: null,
    overrides: { layout: 'hero' },
    elements: [sticker(), chip()],
  }

  it('lays override values over the screen without touching anything else', () => {
    const next = screenWithEdit(screen, { kind: 'settings', fields: { deviceOffset: { dx: 0.1, dy: 0 } } })
    expect(next.overrides).toEqual({ layout: 'hero', deviceOffset: { dx: 0.1, dy: 0 } })
    expect(next.elements).toBe(screen.elements)
    expect(screen.overrides).toEqual({ layout: 'hero' })
  })

  it('patches only the grabbed element', () => {
    const next = screenWithEdit(screen, { kind: 'element', id: 'chip', fields: { width: 0.6, size: 0.03 } })
    expect(next.elements![0]).toBe(screen.elements![0])
    expect(next.elements![1]).toEqual({ ...chip(), width: 0.6, size: 0.03 })
  })
})

describe('resolveOverrides', () => {
  it('drops a 0/0 offset when nothing set-wide needs overruling', () => {
    expect(resolveOverrides({ deviceOffset: { dx: 0, dy: 0 } }, settings())).toEqual({
      deviceOffset: undefined,
    })
  })

  it('keeps a 0/0 offset that overrules a set-wide one', () => {
    const inherited = settings({ textOffset: { dx: 0.1, dy: 0 } })
    expect(resolveOverrides({ textOffset: { dx: 0, dy: 0 } }, inherited)).toEqual({
      textOffset: { dx: 0, dy: 0 },
    })
    expect(resolveOverrides({ textOffset: { dx: 0.1, dy: 0 } }, inherited)).toEqual({ textOffset: undefined })
  })

  it('drops a tilt or scale that equals the set-wide value, keeps any other', () => {
    expect(resolveOverrides({ tilt: 0, deviceScale: 1.05 }, settings())).toEqual({
      tilt: undefined,
      deviceScale: 1.05,
    })
  })

  it('touches only the keys the gesture wrote', () => {
    expect(Object.keys(resolveOverrides({ tilt: 5 }, settings()))).toEqual(['tilt'])
  })
})

describe('changedElementFields', () => {
  it('is null when nothing moved', () => {
    expect(changedElementFields({ x: 0.5, y: 0.5, width: 0.3 }, { x: 0.5, y: 0.5 })).toBeNull()
  })

  it('keeps only what differs', () => {
    expect(changedElementFields({ x: 0.5, y: 0.5, width: 0.3 }, { x: 0.6, y: 0.5 })).toEqual({ x: 0.6 })
  })

  it('drops rotate back to its absent default instead of writing 0', () => {
    expect(changedElementFields({ x: 0, y: 0, width: 1, rotate: 8 }, { rotate: 0 })).toEqual({
      rotate: undefined,
    })
    expect(changedElementFields({ x: 0, y: 0, width: 1 }, { rotate: 0 })).toBeNull()
  })

  it('writes a chip’s size, and only a chip’s', () => {
    expect(changedElementFields({ x: 0, y: 0, width: 1, chip: true }, { size: 0.03 })).toEqual({ size: 0.03 })
    expect(changedElementFields({ x: 0, y: 0, width: 1 }, { size: 0.03 })).toBeNull()
  })
})

describe('formatOffset', () => {
  it('reads as signed percent', () => {
    expect(formatOffset({ dx: 0.03, dy: -0.015 })).toBe('x +3.0 · y −1.5 %')
  })
})
