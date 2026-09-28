import { describe, expect, it } from 'vitest'
import { orientedCorners, sceneTargets, targetKey, type SceneTarget } from './targets'
import { renderScene, type SceneSources } from './scene'
import { getLayout } from '../presets/layouts'
import { DEFAULT_SETTINGS } from '../store'
import type { SceneElement, Screen, Settings } from '../types'

const TILE = { w: 1320, h: 2868 }

/** Measures every character 10 px wide — enough for layout, no canvas needed. */
const measurer = () => ({
  font: '',
  letterSpacing: '0px',
  measureText: (text: string) => ({ width: text.length * 10 }),
})

/** A canvas that records calls, like scene.test.ts's — here only to read where text was drawn. */
function recorder() {
  const calls: { fn: string; args: unknown[] }[] = []
  const props: Record<string, unknown> = {}
  const ctx = new Proxy(props, {
    get(target, prop) {
      const key = String(prop)
      if (key in target) return target[key]
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10 })
      if (key === 'createLinearGradient') return () => ({ addColorStop: () => undefined })
      return (...args: unknown[]) => {
        calls.push({ fn: key, args })
      }
    },
    set(target, prop, value) {
      target[String(prop)] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const screen = (patch: Partial<Screen> = {}): Screen => ({
  id: 'a',
  headline: 'Head *line*',
  subhead: 'Sub',
  imageId: 'shot',
  overrides: { layout: 'text-top', positionId: 'center' },
  ...patch,
})
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch })
const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h }) as unknown as CanvasImageSource
const sources: SceneSources = { self: img(100, 200), elements: { 'artwork/en/kevin': img(200, 100) } }

const targets = (s: Screen, g: Settings = settings(), src: SceneSources = sources) =>
  sceneTargets(measurer(), TILE.w, TILE.h, s, g, src)
const find = (all: SceneTarget[], key: string) => all.find((t) => targetKey(t) === key)!

const kevin = (patch: Partial<SceneElement> = {}): SceneElement =>
  ({
    id: 'kevin',
    imageId: 'artwork/en/kevin',
    x: 0.5,
    y: 0.7,
    width: 0.3,
    rotate: 12,
    layer: 'front',
    shadow: false,
    ...patch,
  }) as SceneElement

describe('sceneTargets', () => {
  it('lists the parts bottom first, in the order renderScene draws them', () => {
    const s = screen({
      elements: [
        { id: 'blob', shape: 'blob', color: '#000', x: 0.5, y: 0.5, width: 0.8, rotate: 0, layer: 'behind' },
        kevin(),
      ],
    })
    expect(targets(s).map(targetKey)).toEqual(['el:blob', 'text', 'device', 'el:kevin'])
  })

  it('frames a sticker exactly where it is drawn, turned by its own rotate', () => {
    const t = find(targets(screen({ elements: [kevin()] })), 'el:kevin')
    const w = 0.3 * TILE.w
    expect(t.frame).toEqual({ cx: 0.5 * TILE.w, cy: 0.7 * TILE.h, w, h: w / 2, angle: 12 })
  })

  it('offers no rotate on a circle or a ring, where a turn shows nothing', () => {
    const shape = (id: string, kind: 'circle' | 'ring' | 'blob') =>
      ({
        id,
        shape: kind,
        color: '#000',
        x: 0.5,
        y: 0.5,
        width: 0.2,
        rotate: 0,
        layer: 'front',
      }) as SceneElement
    const all = targets(screen({ elements: [shape('c', 'circle'), shape('r', 'ring'), shape('b', 'blob')] }))
    const rotatable = (key: string) => (find(all, key) as Extract<SceneTarget, { kind: 'element' }>).rotatable
    expect([rotatable('el:c'), rotatable('el:r'), rotatable('el:b')]).toEqual([false, false, true])
  })

  it('skips a sticker whose image has not loaded and a chip with no text — neither is drawn', () => {
    const chip = {
      id: 'chip',
      text: '',
      size: 0.026,
      x: 0.3,
      y: 0.4,
      width: 0.5,
      rotate: 0,
      layer: 'front',
      shadow: false,
    } as SceneElement
    const all = targets(screen({ elements: [kevin(), chip] }), settings(), { self: img(100, 200) })
    expect(all.map(targetKey)).toEqual(['text', 'device'])
  })

  it('frames a chip around its measured pill', () => {
    const chip = {
      id: 'chip',
      text: '+312',
      size: 0.02,
      x: 0.3,
      y: 0.4,
      width: 0.5,
      rotate: -6,
      layer: 'front',
      shadow: false,
    } as SceneElement
    const t = find(targets(screen({ elements: [chip] })), 'el:chip')
    expect(t.frame.cx).toBeCloseTo(0.3 * TILE.w, 9)
    expect(t.frame.cy).toBeCloseTo(0.4 * TILE.h, 9)
    expect(t.frame.w).toBeGreaterThan(40)
    expect(t.frame.angle).toBe(-6)
  })

  it('moves the device frame by exactly deviceOffset', () => {
    const plain = find(targets(screen()), 'device').frame
    const moved = find(
      targets(screen({ overrides: { ...screen().overrides, deviceOffset: { dx: 0.1, dy: -0.05 } } })),
      'device',
    ).frame
    expect(moved.cx - plain.cx).toBeCloseTo(0.1 * TILE.w, 9)
    expect(moved.cy - plain.cy).toBeCloseTo(-0.05 * TILE.h, 9)
    expect([moved.w, moved.h]).toEqual([plain.w, plain.h])
  })

  it('counts a panorama device offset in composition widths', () => {
    const pano = screen({ overrides: { layout: 'panorama', positionId: 'lean' } })
    const plain = find(targets(pano), 'device').frame
    const moved = find(
      targets({ ...pano, overrides: { ...pano.overrides, deviceOffset: { dx: 0.1, dy: 0 } } }),
      'device',
    ).frame
    expect(moved.cx - plain.cx).toBeCloseTo(0.1 * TILE.w * 2, 9)
  })

  it('moves the text frame by exactly textOffset, and only the text frame', () => {
    const a = targets(screen())
    const b = targets(screen({ overrides: { ...screen().overrides, textOffset: { dx: -0.02, dy: 0.03 } } }))
    expect(find(b, 'text').frame.cx - find(a, 'text').frame.cx).toBeCloseTo(-0.02 * TILE.w, 9)
    expect(find(b, 'text').frame.cy - find(a, 'text').frame.cy).toBeCloseTo(0.03 * TILE.h, 9)
    expect(find(b, 'device').frame).toEqual(find(a, 'device').frame)
  })

  it('frames the copy around every glyph renderScene draws, eyebrow and subhead included', () => {
    const s = screen({
      eyebrow: 'Budget',
      overrides: { ...screen().overrides, textOffset: { dx: 0.05, dy: 0.01 } },
    })
    const g = settings({ accentBar: '#ff0000' })
    const frame = find(targets(s, g), 'text').frame
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, s, g, sources)
    const texts = calls.filter((c) => c.fn === 'fillText')
    expect(texts.length).toBeGreaterThan(0)
    const [left, top] = [frame.cx - frame.w / 2, frame.cy - frame.h / 2]
    for (const c of texts) {
      const [text, x, y] = c.args as [string, number, number]
      expect(x).toBeGreaterThanOrEqual(left - 1e-6)
      expect(x + text.length * 10).toBeLessThanOrEqual(left + frame.w + 1e-6)
      expect(y).toBeGreaterThan(top)
      expect(y).toBeLessThan(top + frame.h)
    }
  })

  it('frames right-to-left copy the same way, flush with the right edge when aligned "left"', () => {
    const s = screen({ headline: 'مرحبا *بك*', subhead: 'نص', lang: 'ar' })
    const g = settings({ textAlign: 'left' })
    const frame = find(targets(s, g), 'text').frame
    const right = frame.cx + frame.w / 2
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, s, g, sources)
    const texts = calls.filter((c) => c.fn === 'fillText')
    const inkRight = Math.max(...texts.map((c) => (c.args[1] as number) + (c.args[0] as string).length * 10))
    expect(inkRight).toBeCloseTo(right, 6)
    expect(right).toBeCloseTo(TILE.w * (1 - getLayout('text-top').padX), 6)
  })

  it('takes feature-wall’s list into the copy, as one unit with the headline', () => {
    const wall = screen({
      kind: 'artwork',
      imageId: null,
      overrides: { layout: 'feature-wall' },
      list: ['One', 'Two', 'Three'],
    })
    const text = find(targets(wall), 'text')
    expect(text.parts).toHaveLength(2)
    const [head, list] = text.parts
    expect(list.cy).toBeGreaterThan(head.cy)
    const top = text.frame.cy - text.frame.h / 2
    expect(top).toBeCloseTo(head.cy - head.h / 2, 9)
  })

  it('offers no device on a deviceless layout or an artwork-kind tile', () => {
    expect(targets(screen({ overrides: { layout: 'text-only' } })).map(targetKey)).toEqual(['text'])
    expect(targets(screen({ kind: 'artwork', imageId: null })).map(targetKey)).toEqual(['text'])
  })

  it('frames the mosaic grid as one unit — turned by tilt, moved by deviceOffset, never scaled', () => {
    const mosaic = screen({ overrides: { layout: 'mosaic', tilt: -4 }, extraIds: ['b', 'c', 'd'] })
    const plain = find(targets(mosaic), 'device') as Extract<SceneTarget, { kind: 'device' }>
    expect(plain.scalable).toBe(false)
    expect(plain.frame.angle).toBe(-4)
    const moved = find(
      targets({ ...mosaic, overrides: { ...mosaic.overrides, deviceOffset: { dx: 0.05, dy: 0.1 } } }),
      'device',
    )
    expect(moved.frame.cx - plain.frame.cx).toBeCloseTo(0.05 * TILE.w, 9)
    expect(moved.frame.cy - plain.frame.cy).toBeCloseTo(0.1 * TILE.h, 9)
  })

  it('encloses every device of a multi-device arrangement, and hits each on its own', () => {
    const duo = find(targets(screen({ overrides: { layout: 'duo', positionId: 'duo' } })), 'device')
    expect(duo.parts).toHaveLength(2)
    const corners = duo.parts.flatMap(orientedCorners)
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(duo.frame.cx - duo.frame.w / 2 - 1e-6)
      expect(c.x).toBeLessThanOrEqual(duo.frame.cx + duo.frame.w / 2 + 1e-6)
    }
  })
})
