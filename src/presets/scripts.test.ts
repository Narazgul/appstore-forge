import { describe, expect, it } from 'vitest'
import { fontStackFor, isRtl, scriptFontFor } from './scripts'

describe('scriptFontFor', () => {
  it('returns null for Latin, Cyrillic and Vietnamese, which Inter covers', () => {
    for (const lang of ['en', 'de', 'ru', 'vi', 'pt-BR', undefined]) expect(scriptFontFor(lang)).toBeNull()
  })
  it('maps each script to its Noto family', () => {
    expect(scriptFontFor('ar')?.family).toBe('Noto Sans Arabic')
    expect(scriptFontFor('th')?.family).toBe('Noto Sans Thai')
    expect(scriptFontFor('zh')?.family).toBe('Noto Sans SC')
    expect(scriptFontFor('zh-TW')?.family).toBe('Noto Sans TC')
    expect(scriptFontFor('ko')?.family).toBe('Noto Sans KR')
    expect(scriptFontFor('ja')?.family).toBe('Noto Sans JP')
  })
})

describe('isRtl', () => {
  it('is true for Arabic, Hebrew, Persian, Urdu and false otherwise', () => {
    expect(['ar', 'ar-SA', 'he', 'fa', 'ur'].map(isRtl)).toEqual([true, true, true, true, true])
    expect(['en', 'de', undefined].map(isRtl)).toEqual([false, false, false])
  })
})

describe('fontStackFor', () => {
  it('puts the script font before the chosen family so glyphs never fall back', () => {
    expect(fontStackFor('inter', 'ar')).toMatch(/^"Noto Sans Arabic", "Inter Variable"/)
  })
  it('is the plain stack for Latin', () => {
    expect(fontStackFor('inter', 'de')).toMatch(/^"Inter Variable"/)
  })
})
