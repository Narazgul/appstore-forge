import { describe, expect, it } from 'vitest'
import type { Finish } from '../types'
import { FINISH_DEFAULTS, FINISH_KINDS, applyFinish, coverBox, hasBackgroundLayers } from './finishes'

/** A small picture with real structure: a diagonal gradient with a dark block in it. */
function picture(w = 64, h = 80) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const block = x > 20 && x < 40 && y > 30 && y < 50
      data[i] = block ? 30 : (x * 255) / w
      data[i + 1] = block ? 40 : (y * 255) / h
      data[i + 2] = block ? 90 : 160
      data[i + 3] = 255
    }
  return { data, w, h }
}

const run = (finish: Finish) => {
  const px = picture()
  applyFinish(px, finish, 64)
  return px.data
}

describe('coverBox', () => {
  it('fills the area and centres the focus as far as the edges allow', () => {
    const box = coverBox(200, 100, 100, 100, { src: 'a.jpg' })
    expect(box).toEqual({ x: -50, y: 0, w: 200, h: 100 })
    expect(coverBox(200, 100, 100, 100, { src: 'a.jpg', focusX: 0 }).x).toBe(0)
    expect(coverBox(200, 100, 100, 100, { src: 'a.jpg', focusX: 1 }).x).toBe(-100)
  })

  it('zooms in around the focus, never below a full cover', () => {
    const box = coverBox(100, 100, 100, 100, { src: 'a.jpg', zoom: 2, focusX: 0.25, focusY: 0.25 })
    expect(box).toEqual({ x: 0, y: 0, w: 200, h: 200 })
    expect(coverBox(100, 100, 100, 100, { src: 'a.jpg', zoom: 0.5 }).w).toBe(100)
  })
})

describe('hasBackgroundLayers', () => {
  it('is false for a plain colour or gradient and an empty finish list', () => {
    expect(hasBackgroundLayers({ kind: 'solid', color: '#fff' })).toBe(false)
    expect(hasBackgroundLayers({ kind: 'solid', color: '#fff', finish: [] })).toBe(false)
    expect(
      hasBackgroundLayers({
        kind: 'gradient',
        from: '#fff',
        to: '#000',
        angle: 90,
        finish: [{ kind: 'grain' }],
      }),
    ).toBe(true)
    expect(hasBackgroundLayers({ kind: 'solid', color: '#fff', image: { src: 'a.jpg' } })).toBe(true)
  })
})

describe('applyFinish', () => {
  it.each(FINISH_KINDS)(
    '%s draws the same pixels on every run, changes the picture and keeps it opaque',
    (kind) => {
      const a = run({ kind } as Finish)
      const b = run({ kind } as Finish)
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
      expect(Buffer.from(a).equals(Buffer.from(picture().data))).toBe(false)
      for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255)
    },
  )

  it('takes its noise from the seed alone', () => {
    const one = run({ kind: 'grain', seed: 1 })
    expect(Buffer.from(run({ kind: 'grain', seed: 1 })).equals(Buffer.from(one))).toBe(true)
    expect(Buffer.from(run({ kind: 'grain', seed: 2 })).equals(Buffer.from(one))).toBe(false)
    expect(Buffer.from(run({ kind: 'riso', seed: 2 })).equals(Buffer.from(run({ kind: 'riso' })))).toBe(false)
  })

  it('dither leaves exactly its two colours', () => {
    const d = run({ kind: 'dither', dark: '#000000', light: '#ffffff' })
    for (let i = 0; i < d.length; i += 4) expect([0, 255]).toContain(d[i])
  })

  it('duotone maps black and white onto its two colours', () => {
    const px = { data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), w: 2, h: 1 }
    applyFinish(px, { kind: 'duotone', dark: '#102030', light: '#f0e0d0' }, 2)
    expect([...px.data]).toEqual([16, 32, 48, 255, 240, 224, 208, 255])
  })

  it('every finish has defaults for each of its fields', () => {
    expect(Object.keys(FINISH_DEFAULTS).sort()).toEqual([...FINISH_KINDS].sort())
  })
})
