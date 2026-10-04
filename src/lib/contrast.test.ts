import { describe, expect, it } from 'vitest'
import {
  blendOverBackground,
  contrastAgainstBackground,
  contrastAgainstColors,
  contrastRatio,
  mix,
  parseHexColor,
  relativeLuminance,
  toHexColor,
} from './contrast'

describe('parseHexColor', () => {
  it('reads a 6-digit hex colour', () => {
    expect(parseHexColor('#1e6ff5')).toEqual({ r: 0x1e, g: 0x6f, b: 0xf5 })
  })

  it('expands a 3-digit hex colour', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('accepts a colour with no leading #', () => {
    expect(parseHexColor('000000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('throws on garbage', () => {
    expect(() => parseHexColor('not-a-colour')).toThrow()
  })
})

describe('toHexColor', () => {
  it('round-trips through parseHexColor', () => {
    expect(toHexColor(parseHexColor('#1e6ff5'))).toBe('#1e6ff5')
  })

  it('clamps out-of-range channels', () => {
    expect(toHexColor({ r: 300, g: -10, b: 128 })).toBe('#ff0080')
  })
})

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#5B7CFA', '#5B7CFA')).toBeCloseTo(1, 5)
  })

  it('is the textbook ~4.54 for #767676 on white', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1)
  })

  it('does not care about argument order', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#767676'), 10)
  })
})

describe('mix', () => {
  it('is `a` at t=0 and `b` at t=1', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('is the midpoint at t=0.5', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('blendOverBackground', () => {
  it('is the background at alpha 0', () => {
    expect(blendOverBackground('#000000', 0, '#eaf2ff')).toBe('#eaf2ff')
  })

  it('is the foreground at alpha 1', () => {
    expect(blendOverBackground('#111114', 1, '#eaf2ff')).toBe('#111114')
  })

  it('is standard alpha-over compositing: bg + (fg - bg) * alpha, per channel', () => {
    const fg = parseHexColor('#111114')
    const bg = parseHexColor('#eaf2ff')
    const alpha = 0.72
    const expected = toHexColor({
      r: bg.r + (fg.r - bg.r) * alpha,
      g: bg.g + (fg.g - bg.g) * alpha,
      b: bg.b + (fg.b - bg.b) * alpha,
    })
    expect(blendOverBackground('#111114', alpha, '#eaf2ff')).toBe(expected)
  })
})

describe('contrastAgainstBackground', () => {
  it('reads a solid background directly', () => {
    expect(contrastAgainstBackground('#111114', { kind: 'solid', color: '#eaf2ff' })).toBeCloseTo(
      contrastRatio('#111114', '#eaf2ff'),
      10,
    )
  })

  it('takes the worse of the two gradient stops', () => {
    const bg = { kind: 'gradient' as const, from: '#ffffff', to: '#eeeeee', angle: 135 }
    const ratio = contrastAgainstBackground('#767676', bg)
    expect(ratio).toBeCloseTo(
      Math.min(contrastRatio('#767676', '#ffffff'), contrastRatio('#767676', '#eeeeee')),
      5,
    )
    // The lighter, closer-to-fg stop is the worse one.
    expect(ratio).toBeLessThan(contrastRatio('#767676', '#ffffff'))
  })

  it('blends the foreground before comparing when alpha < 1', () => {
    const opaque = contrastAgainstBackground('#111114', { kind: 'solid', color: '#eaf2ff' })
    const translucent = contrastAgainstBackground('#111114', { kind: 'solid', color: '#eaf2ff' }, 0.72)
    expect(translucent).toBeLessThan(opaque)
  })
})

describe('contrastAgainstColors', () => {
  it('takes the worst colour and blends a translucent fg into each', () => {
    expect(contrastAgainstColors('#000000', ['#ffffff', '#777777'])).toBe(contrastRatio('#000000', '#777777'))
    expect(contrastAgainstColors('#000000', ['#ffffff'], 0.72)).toBe(
      contrastRatio(blendOverBackground('#000000', 0.72, '#ffffff'), '#ffffff'),
    )
  })
})
