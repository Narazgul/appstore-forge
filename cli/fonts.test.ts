import { GlobalFonts, createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { FONTS } from '../src/presets/fonts'
import { setHeadFont, setSubFont } from '../src/render/text'
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
})
