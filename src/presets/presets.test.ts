import { describe, expect, it } from 'vitest'
import { DEVICES, FRAME_COLORS, frameAspect, getDevice, getFrameColor } from './devices'
import { FONTS, getFont } from './fonts'
import { LAYOUTS, getLayout } from './layouts'
import { POSITIONS, getPosition } from './positions'
import { RHYTHMS, getRhythm, rhythmStep } from './rhythms'
import { EXPORT_SIZES, getSize } from './sizes'
import { TEMPLATES, getTemplateSpec } from './templates'
import { DEFAULT_SETTINGS } from '../store'
import { composeDevices } from '../render/scene'
import type { LayoutId } from '../types'

/**
 * Integrity of the preset tables. Every id in here is a plain string that some other table
 * has to resolve, and a typo degrades silently into a fallback rather than throwing — which
 * is exactly the kind of thing a contributor adding a template would ship without noticing.
 */

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id)
const layoutIds = new Set(ids(LAYOUTS))
const positionIds = new Set(ids(POSITIONS))

/** Widened to the one property every table shares, so `describe.each` can iterate them together. */
const tables: Record<string, { id: string }[]> = {
  devices: DEVICES,
  frameColors: FRAME_COLORS,
  fonts: FONTS,
  layouts: LAYOUTS,
  positions: POSITIONS,
  rhythms: RHYTHMS,
  sizes: EXPORT_SIZES,
  templates: TEMPLATES,
}

describe.each(Object.entries(tables))('%s table', (_name, rows) => {
  it('is not empty', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    expect(new Set(ids(rows)).size).toBe(rows.length)
  })
})

describe('lookups', () => {
  it('resolve every id in their own table', () => {
    for (const d of DEVICES) expect(getDevice(d.id)).toBe(d)
    for (const c of FRAME_COLORS) expect(getFrameColor(c.id)).toBe(c)
    for (const f of FONTS) expect(getFont(f.id)).toBe(f)
    for (const l of LAYOUTS) expect(getLayout(l.id)).toBe(l)
    for (const p of POSITIONS) expect(getPosition(p.id)).toBe(p)
    for (const r of RHYTHMS) expect(getRhythm(r.id)).toBe(r)
    for (const s of EXPORT_SIZES) expect(getSize(s.id)).toBe(s)
    for (const t of TEMPLATES) expect(getTemplateSpec(t.id)).toBe(t)
  })

  it('fall back to the first row rather than throwing on an unknown id', () => {
    expect(getDevice('nope')).toBe(DEVICES[0])
    expect(getLayout('nope' as LayoutId)).toBe(LAYOUTS[0])
    expect(getSize('nope')).toBe(EXPORT_SIZES[0])
  })
})

describe('defaults', () => {
  it('point at rows that actually exist', () => {
    expect(getDevice(DEFAULT_SETTINGS.deviceId).id).toBe(DEFAULT_SETTINGS.deviceId)
    expect(getFrameColor(DEFAULT_SETTINGS.frameColorId).id).toBe(DEFAULT_SETTINGS.frameColorId)
    expect(getFont(DEFAULT_SETTINGS.fontId).id).toBe(DEFAULT_SETTINGS.fontId)
    expect(getSize(DEFAULT_SETTINGS.sizeId).id).toBe(DEFAULT_SETTINGS.sizeId)
    expect(positionIds.has(DEFAULT_SETTINGS.positionId)).toBe(true)
    expect(layoutIds.has(DEFAULT_SETTINGS.layout)).toBe(true)
  })
})

describe('devices', () => {
  it('describe a plausible frame: bezel and radius are small fractions of the width', () => {
    for (const d of DEVICES) {
      // 'No frame' is legitimately bezel-less; everything else must have some body around the screen.
      expect(d.bezel).toBeGreaterThanOrEqual(0)
      expect(d.bezel).toBeLessThan(0.2)
      expect(d.radius).toBeGreaterThan(0)
      expect(d.radius).toBeLessThan(0.5)
      expect(d.screenAspect).toBeGreaterThan(0)
    }
  })

  it('are all taller than they are wide, once the bezel is added', () => {
    for (const d of DEVICES) expect(frameAspect(d)).toBeLessThan(1)
  })
})

describe('layouts', () => {
  it('put the device band inside the canvas, or deliberately off the bottom', () => {
    for (const l of LAYOUTS) {
      expect(l.device.top).toBeGreaterThanOrEqual(0)
      expect(l.device.bottom).toBeGreaterThan(l.device.top)
      expect(l.padX).toBeGreaterThanOrEqual(0)
      expect(l.padX).toBeLessThan(0.5)
    }
  })

  it('keep the list band on the canvas, wherever one exists', () => {
    for (const l of LAYOUTS) {
      if (!l.list) continue
      expect(l.list.top).toBeGreaterThanOrEqual(0)
      expect(l.list.top + l.list.height).toBeLessThanOrEqual(1)
    }
  })

  it('never draw a device for a deviceless layout', () => {
    for (const l of LAYOUTS) {
      if (!l.deviceless) continue
      expect(composeDevices(l, 'center', 100, 200, 0.5, 1, 0)).toEqual([])
    }
  })

  it('keep the text band on the canvas', () => {
    for (const l of LAYOUTS) {
      if (!l.text) continue
      expect(l.text.top).toBeGreaterThanOrEqual(0)
      expect(l.text.top + l.text.height).toBeLessThanOrEqual(1)
    }
  })
})

describe('rhythms', () => {
  it('only reference layouts and arrangements that exist', () => {
    for (const rhythm of RHYTHMS) {
      for (const step of rhythm.steps) {
        expect(layoutIds.has(step.layout)).toBe(true)
        expect(positionIds.has(step.positionId)).toBe(true)
      }
    }
  })

  it('repeat from the start once the set is longer than the rhythm', () => {
    const rhythm = RHYTHMS.find((r) => r.steps.length > 0)!
    expect(rhythmStep(rhythm, rhythm.steps.length)).toBe(rhythm.steps[0])
  })

  it('pins nothing for the uniform rhythm', () => {
    expect(rhythmStep(getRhythm('uniform'), 0)).toBeNull()
  })
})

describe('templates', () => {
  it('only reference presets that exist', () => {
    for (const t of TEMPLATES) {
      if (t.settings.layout) expect(layoutIds.has(t.settings.layout)).toBe(true)
      if (t.settings.positionId) expect(positionIds.has(t.settings.positionId)).toBe(true)
      if (t.settings.fontId) expect(getFont(t.settings.fontId).id).toBe(t.settings.fontId)
      if (t.settings.frameColorId)
        expect(getFrameColor(t.settings.frameColorId).id).toBe(t.settings.frameColorId)
      if (t.rhythm) expect(getRhythm(t.rhythm).id).toBe(t.rhythm)
      for (const variant of t.variants ?? []) {
        if (variant.layout) expect(layoutIds.has(variant.layout)).toBe(true)
        if (variant.positionId) expect(positionIds.has(variant.positionId)).toBe(true)
      }
    }
  })

  it('carry sample copy, which empty slots render before any screenshot lands', () => {
    for (const t of TEMPLATES) {
      expect(t.samples.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
    }
  })

  it('never pin the export size or device — those stay the user’s choice', () => {
    for (const t of TEMPLATES) {
      expect(t.settings).not.toHaveProperty('sizeId')
      expect(t.settings).not.toHaveProperty('deviceId')
    }
  })
})

describe('export sizes', () => {
  it('are integer pixel dimensions for a real store slot', () => {
    for (const s of EXPORT_SIZES) {
      expect(Number.isInteger(s.w)).toBe(true)
      expect(Number.isInteger(s.h)).toBe(true)
    }
  })

  it('are portrait in the stores, except the Play feature graphic', () => {
    for (const s of EXPORT_SIZES) {
      if (s.store === 'Studio') continue
      if (s.id === 'play-feature-graphic') expect(s.w).toBeGreaterThan(s.h)
      else expect(s.h).toBeGreaterThan(s.w)
    }
  })

  it('offer the studio formats at their exact pixel sizes', () => {
    const studio = Object.fromEntries(
      EXPORT_SIZES.filter((s) => s.store === 'Studio').map((s) => [s.id, `${s.w}x${s.h}`]),
    )
    expect(studio).toEqual({
      'studio-4x5': '1080x1350',
      'studio-square': '1080x1080',
      'studio-16x9': '1920x1080',
      'open-graph': '1200x630',
      story: '1080x1920',
    })
  })
})
