import { describe, expect, it } from 'vitest'
import { fontStackFor, isRtl, languageGroupFor, resolveFontId, scriptFontFor } from './scripts'

describe('scriptFontFor', () => {
  it('returns null for Latin, Cyrillic and Vietnamese, which Inter covers', () => {
    for (const lang of ['en', 'de', 'ru', 'vi', 'pt-BR', undefined]) expect(scriptFontFor(lang)).toBeNull()
  })
  it('maps each script to its Noto family', () => {
    expect(scriptFontFor('ar')?.family).toBe('Noto Sans Arabic')
    expect(scriptFontFor('th')?.family).toBe('Noto Sans Thai')
    expect(scriptFontFor('zh')?.family).toBe('Noto Sans SC')
    expect(scriptFontFor('zh-TW')?.family).toBe('Noto Sans TC')
    expect(scriptFontFor('zh-HK')?.family).toBe('Noto Sans TC')
    expect(scriptFontFor('zh-MO')?.family).toBe('Noto Sans TC')
    expect(scriptFontFor('zh-Hant')?.family).toBe('Noto Sans TC')
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

describe('languageGroupFor', () => {
  it('groups Polish and Turkish as latin-ext, Russian as cyrillic, Vietnamese on its own', () => {
    expect(['pl', 'tr'].map(languageGroupFor)).toEqual(['latin-ext', 'latin-ext'])
    expect(languageGroupFor('ru')).toBe('cyrillic')
    expect(languageGroupFor('vi')).toBe('vietnamese')
  })
  it('defaults everything else, including no language at all, to latin', () => {
    expect(['en', 'de', 'es-MX', 'id', undefined].map(languageGroupFor)).toEqual(Array(5).fill('latin'))
  })
})

describe('resolveFontId', () => {
  it('keeps a font that covers the language', () => {
    expect(resolveFontId('nunito', 'ru')).toBe('nunito')
    expect(resolveFontId('baloo-2', 'vi')).toBe('baloo-2')
  })
  it('falls back to Inter when the font does not cover the language', () => {
    expect(resolveFontId('baloo-2', 'ru')).toBe('inter')
    expect(resolveFontId('dm-sans', 'vi')).toBe('inter')
  })
  it('never redirects Inter itself, which covers every group', () => {
    for (const lang of ['ru', 'vi', 'pl', 'tr', 'en']) expect(resolveFontId('inter', lang)).toBe('inter')
  })
  it('ignores coverage for a scripted language — the base family never draws its glyphs', () => {
    expect(resolveFontId('baloo-2', 'ja')).toBe('baloo-2')
    expect(resolveFontId('dm-sans', 'ar')).toBe('dm-sans')
  })
})
