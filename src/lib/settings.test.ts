import { describe, expect, it } from 'vitest'
import { SECTION_KEYS, effectiveSettings, isOverridden } from './settings'
import { DEFAULT_SETTINGS } from '../store'
import type { OverridableKey, PaletteColors, Screen } from '../types'

const screen = (overrides: Screen['overrides'] = {}): Screen => ({
  id: 'test',
  headline: '',
  subhead: '',
  imageId: null,
  overrides,
})

const altColors: PaletteColors = {
  background: { kind: 'solid', color: '#0b1020' },
  textColor: '#f8fafc',
  eyebrowColor: '#8b5cf6',
  highlights: ['#8b5cf6'],
}

describe('effectiveSettings', () => {
  it('falls through to the global settings when nothing is overridden', () => {
    expect(effectiveSettings(screen(), DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it("lets a screen's own value win", () => {
    const resolved = effectiveSettings(screen({ tilt: 8 }), DEFAULT_SETTINGS)
    expect(resolved.tilt).toBe(8)
    expect(resolved.layout).toBe(DEFAULT_SETTINGS.layout)
  })

  it('defaults deviceShadow to "soft" and lets a screen override it', () => {
    expect(DEFAULT_SETTINGS.deviceShadow).toBe('soft')
    const resolved = effectiveSettings(screen({ deviceShadow: 'hard' }), DEFAULT_SETTINGS)
    expect(resolved.deviceShadow).toBe('hard')
  })

  it('does not mutate either input', () => {
    const global = { ...DEFAULT_SETTINGS }
    const s = screen({ tilt: 8 })
    effectiveSettings(s, global)
    expect(global).toEqual(DEFAULT_SETTINGS)
    expect(s.overrides).toEqual({ tilt: 8 })
  })

  describe('a "contrast tile" (inverted + altColors)', () => {
    const global = { ...DEFAULT_SETTINGS, altColors, inverted: true }

    it('leaves colours alone when altColors is null even if inverted is true', () => {
      const resolved = effectiveSettings(screen(), { ...DEFAULT_SETTINGS, inverted: true, altColors: null })
      expect(resolved.background).toEqual(DEFAULT_SETTINGS.background)
      expect(resolved.textColor).toBe(DEFAULT_SETTINGS.textColor)
    })

    it('leaves colours alone when altColors is set but inverted is false', () => {
      const resolved = effectiveSettings(screen(), { ...DEFAULT_SETTINGS, inverted: false, altColors })
      expect(resolved.background).toEqual(DEFAULT_SETTINGS.background)
      expect(resolved.textColor).toBe(DEFAULT_SETTINGS.textColor)
    })

    it('swaps background, textColor, eyebrowColor and highlights for the alt pair', () => {
      const resolved = effectiveSettings(screen(), global)
      expect(resolved.background).toEqual(altColors.background)
      expect(resolved.textColor).toBe(altColors.textColor)
      expect(resolved.eyebrowColor).toBe(altColors.eyebrowColor)
      expect(resolved.highlights).toEqual(altColors.highlights)
    })

    it('leaves every other key at the global value', () => {
      const resolved = effectiveSettings(screen(), global)
      expect(resolved.layout).toBe(global.layout)
      expect(resolved.deviceId).toBe(global.deviceId)
      expect(resolved.backdropColor).toBe(global.backdropColor)
    })

    it('lets an explicit screen override win over the alt pair (global → alt → override)', () => {
      const resolved = effectiveSettings(screen({ textColor: '#ff0000' }), global)
      expect(resolved.textColor).toBe('#ff0000')
      // The keys the screen did not touch still come from the alt pair, not the global settings.
      expect(resolved.background).toEqual(altColors.background)
    })

    it('honours an explicit null eyebrowColor override over the alt pair', () => {
      const resolved = effectiveSettings(screen({ eyebrowColor: null }), global)
      expect(resolved.eyebrowColor).toBeNull()
    })

    it('a screen can invert on its own while the global stays uninverted', () => {
      const base = { ...DEFAULT_SETTINGS, altColors }
      const resolved = effectiveSettings(screen({ inverted: true }), base)
      expect(resolved.background).toEqual(altColors.background)
    })

    it('a screen can opt out of a global inversion', () => {
      const resolved = effectiveSettings(screen({ inverted: false }), global)
      expect(resolved.background).toEqual(DEFAULT_SETTINGS.background)
    })
  })
})

describe('isOverridden', () => {
  it('is false with no screen selected', () => {
    expect(isOverridden(null, 'tilt')).toBe(false)
  })

  it('tracks exactly which key the screen pins', () => {
    const s = screen({ tilt: 8 })
    expect(isOverridden(s, 'tilt')).toBe(true)
    expect(isOverridden(s, 'layout')).toBe(false)
  })
})

describe('SECTION_KEYS', () => {
  const listed = Object.values(SECTION_KEYS).flat()

  it('reaches every overridable setting, so nothing is unresettable', () => {
    const all = (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).filter(
      (k) => k !== 'sizeId',
    ) as OverridableKey[]
    expect([...listed].sort()).toEqual([...all].sort())
  })

  it('assigns each key to exactly one section', () => {
    expect(new Set(listed).size).toBe(listed.length)
  })
})
