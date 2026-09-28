import { describe, expect, it } from 'vitest'
import { AA_NORMAL_TEXT, contrastRatio } from '../lib/contrast'
import { PALETTES, getPalette } from './palettes'

describe('PALETTES', () => {
  it('has all 23 ported palettes', () => {
    expect(PALETTES).toHaveLength(23)
  })

  it('has a unique id per palette', () => {
    const ids = PALETTES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every palette a label', () => {
    for (const p of PALETTES) expect(p.label.length).toBeGreaterThan(0)
  })

  for (const p of PALETTES) {
    describe(p.id, () => {
      it('every highlight in the main pair reaches AA against its own text colour', () => {
        expect(p.colors.highlights.length).toBeGreaterThan(0)
        for (const highlight of p.colors.highlights) {
          expect(contrastRatio(p.colors.textColor, highlight)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
        }
      })

      it('every highlight in the alt pair reaches AA against its own text colour', () => {
        expect(p.alt.highlights.length).toBeGreaterThan(0)
        for (const highlight of p.alt.highlights) {
          expect(contrastRatio(p.alt.textColor, highlight)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
        }
      })

      it('the eyebrow colour of both pairs reaches AA on its background', () => {
        for (const colors of [p.colors, p.alt]) {
          const bg = colors.background.kind === 'solid' ? colors.background.color : ''
          expect(contrastRatio(colors.eyebrowColor ?? colors.textColor, bg)).toBeGreaterThanOrEqual(
            AA_NORMAL_TEXT,
          )
        }
      })

      it('never carries more than two highlights per pair', () => {
        expect(p.colors.highlights.length).toBeLessThanOrEqual(2)
        expect(p.alt.highlights.length).toBeLessThanOrEqual(2)
      })

      it('both pairs use a solid background', () => {
        expect(p.colors.background.kind).toBe('solid')
        expect(p.alt.background.kind).toBe('solid')
      })
    })
  }
})

describe('getPalette', () => {
  it('finds a palette by id', () => {
    expect(getPalette('dark-bold').label).toBe('Dark Bold')
  })

  it('falls back to the first palette for an unknown id, like every other preset lookup', () => {
    expect(getPalette('nope')).toBe(PALETTES[0])
  })
})
