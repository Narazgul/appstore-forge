import { GlobalFonts, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { FONTS } from '../src/presets/fonts'
import { setHeadFont, setLabelSubFont, setSubFont } from '../src/render/text'
import { DEFAULT_SETTINGS } from '../src/store'
import type { Settings } from '../src/types'
import { registerFonts } from './fonts'

type Setter = (ctx: never, size: number, settings: Settings, lang?: string) => void

function width(setFont: Setter, settings: Settings, text: string): number {
  const ctx = createCanvas(10, 10).getContext('2d')
  setFont(ctx as never, 100, settings)
  return ctx.measureText(text).width
}

/** Ink, not width: CJK glyphs are full-width at every weight, so only the strokes show it. */
function ink(setFont: Setter, settings: Settings, text: string, lang?: string, axis?: string): number {
  const canvas = createCanvas(1400, 160)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 1400, 160)
  setFont(ctx as never, 100, settings, lang)
  if (axis) ctx.fontVariationSettings = axis
  ctx.fillStyle = '#000'
  ctx.fillText(text, 10, 120)
  const data = ctx.getImageData(0, 0, 1400, 160).data
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += 255 - data[i]
  return sum / 255
}

describe('registerFonts', () => {
  it('registers a Skia family for every FONTS entry that has one', () => {
    registerFonts()
    for (const font of FONTS.filter((f) => f.family)) expect(GlobalFonts.has(font.family)).toBe(true)
  })

  // Skia fakes bold by thickening strokes when it cannot find the weight, which adds ink but keeps
  // the advance widths; a real bold instance is wider.
  it('draws a real bold headline for every font, variable masters included', () => {
    registerFonts()
    for (const font of FONTS.filter((f) => f.family)) {
      const settings = { ...DEFAULT_SETTINGS, fontId: font.id, headlineTracking: 0 }
      const head = width(setHeadFont, settings, 'The quick brown fox')
      const sub = width(setSubFont, settings, 'The quick brown fox')
      expect(head, `${font.id}: bold headline should set wider than the regular subhead`).toBeGreaterThan(sub)
    }
  })

  it('draws script fonts at their real weights, not the variable default instance', () => {
    registerFonts()
    const samples: [string, string][] = [
      ['ja', 'デジタルな袋分け家計簿'],
      ['ko', '디지털 봉투 예산법'],
      ['zh', '数字信封预算'],
      ['zh-TW', '數位信封預算'],
      ['th', 'งบประมาณแบบซองดิจิทัล'],
      ['ar', 'ميزانية الأظرف الرقمية'],
    ]
    for (const [lang, text] of samples) {
      const head = ink(setHeadFont, DEFAULT_SETTINGS, text, lang)
      const sub = ink(setSubFont, DEFAULT_SETTINGS, text, lang)
      const thin = ink(setSubFont, DEFAULT_SETTINGS, text, lang, '"wght" 100')
      expect(head, `${lang}: headline should carry more ink than the subhead`).toBeGreaterThan(sub * 1.2)
      expect(sub, `${lang}: subhead should be regular, not the thin default instance`).toBeGreaterThan(
        thin * 1.5,
      )
    }
  })

  // Baloo 2, Nunito, DM Sans, Poppins, Space Grotesk and Playfair ship only Regular/Bold static
  // files (see FONT_FILES above and the comment on STATIC_WEIGHT_FAMILIES in render/text.ts) —
  // 600 is mapped to 700 for all of them, in the GUI and here, so the two runtimes agree.
  const STATIC_WEIGHT_FAMILIES = ['baloo-2', 'nunito', 'dm-sans', 'poppins', 'space-grotesk', 'playfair']

  it('draws weight 600 identically to 700 for every static-only family', () => {
    registerFonts()
    for (const id of STATIC_WEIGHT_FAMILIES) {
      const settings = { ...DEFAULT_SETTINGS, fontId: id, headlineTracking: 0 }
      const w600 = width(setLabelSubFont, settings, 'The quick brown fox')
      const w700 = width(setHeadFont, settings, 'The quick brown fox')
      expect(w600, `${id}: weight 600 should resolve to the same advance width as 700`).toBeCloseTo(w700, 5)
    }
  })

  it('draws a real weight 600 for Inter, distinct from both 400 and 700', () => {
    registerFonts()
    const settings = { ...DEFAULT_SETTINGS, fontId: 'inter', headlineTracking: 0 }
    const w400 = width(setSubFont, settings, 'The quick brown fox')
    const w600 = width(setLabelSubFont, settings, 'The quick brown fox')
    const w700 = width(setHeadFont, settings, 'The quick brown fox')
    expect(
      w600,
      'weight 600 should sit strictly between 400 and 700, not collapse to either',
    ).toBeGreaterThan(w400)
    expect(w600).toBeLessThan(w700)
  })

  it('draws script fonts at a real weight 600, not the static-family downgrade to 700', () => {
    registerFonts()
    const samples: [string, string][] = [
      ['ja', 'デジタルな袋分け家計簿'],
      ['ar', 'ميزانية الأظرف الرقمية'],
    ]
    for (const [lang, text] of samples) {
      // fontId is a static family here on purpose — a script language must still get the Noto
      // face's own real 600, ignoring the Latin fontId's downgrade rule entirely.
      const settings = { ...DEFAULT_SETTINGS, fontId: 'poppins' }
      const ink400 = ink(setSubFont, settings, text, lang)
      const ink600 = ink(setLabelSubFont, settings, text, lang)
      const ink700 = ink(setHeadFont, settings, text, lang)
      expect(ink600, `${lang}: 600 should carry more ink than 400`).toBeGreaterThan(ink400)
      expect(ink600, `${lang}: 600 should not be as heavy as 700`).toBeLessThan(ink700)
    }
  })
})
