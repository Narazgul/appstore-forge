import { describe, expect, it } from 'vitest'
import { localeLabel } from './localeLabel'
import type { ProjectLocale } from './types'

const locale = (id: string, store: Record<string, string> = {}): ProjectLocale => ({ id, store })

describe('localeLabel', () => {
  it('takes the region from the id when it carries one', () => {
    expect(localeLabel(locale('de-DE'))).toBe('🇩🇪 Deutsch')
  })

  it('takes the region from the App Store code when the id has none', () => {
    expect(localeLabel(locale('en', { appstore: 'en-US', play: 'en-GB' }))).toBe('🇺🇸 Englisch')
  })

  it('falls back to any other store code when there is no App Store one', () => {
    expect(localeLabel(locale('en', { play: 'en-GB' }))).toBe('🇬🇧 Englisch')
  })

  it('falls back to the region map for a region-less id without store codes', () => {
    expect(localeLabel(locale('de'))).toBe('🇩🇪 Deutsch')
    expect(localeLabel(locale('zh-Hans'))).toBe('🇨🇳 Chinesisch (vereinfacht)')
  })

  it('flags a script-and-region id by its region', () => {
    expect(localeLabel(locale('zh-TW'))).toBe('🇹🇼 Chinesisch')
  })

  it('leaves an unknown id bare, without a flag', () => {
    expect(localeLabel(locale('xq'))).toBe('xq')
  })
})
