import { describe, expect, it } from 'vitest'
import { imageIdFor, outPath, screensFor, settingsFor, sourcePath } from './bridge'
import type { Project } from './types'

const project: Project = {
  set: {
    version: 1,
    id: 'default',
    targets: [
      {
        id: 'appstore',
        sizeId: 'iphone-6-9',
        deviceId: 'iphone-17-pro',
        out: 'fastlane/screenshots/ios/{storeLocale}/{n}_{storeLocale}.png',
      },
      {
        id: 'play',
        sizeId: 'android-phone-tall',
        deviceId: 'pixel-9-pro',
        out: 'fastlane/metadata/android/{storeLocale}/images/phoneScreenshots/{n}_{storeLocale}.png',
      },
    ],
    locales: [
      { id: 'en', store: { appstore: 'en-US', play: 'en-US' } },
      { id: 'de', store: { appstore: 'de-DE', play: 'de-DE' } },
    ],
    sources: 'outputs/screenshots/{locale}/{screen}.png',
    settings: { layout: 'bleed', background: { kind: 'solid', color: '#5D48E7' } },
    slots: [
      { id: 'budget-light', kind: 'screen', screen: 'budget_screen', overrides: {} },
      { id: 'accounts', kind: 'screen', screen: 'account_screen', overrides: { layout: 'hero' } },
    ],
    approval: null,
  },
  copies: {
    en: { 'budget-light': { headline: 'Master *your budget*', subhead: '' } },
    de: {
      'budget-light': { headline: 'Budget *meistern*', subhead: 'Jeder Euro bekommt eine Aufgabe.' },
      accounts: { headline: 'Alle Konten', subhead: '' },
    },
  },
}

describe('screensFor', () => {
  it('builds one screen per slot with the locale copy and the slot overrides', () => {
    const screens = screensFor(project, 'de')
    expect(screens.map((s) => s.id)).toEqual(['budget-light', 'accounts'])
    expect(screens[0].headline).toBe('Budget *meistern*')
    expect(screens[0].subhead).toBe('Jeder Euro bekommt eine Aufgabe.')
    expect(screens[0].imageId).toBe('de/budget_screen')
    expect(screens[1].overrides).toEqual({ layout: 'hero' })
    expect(screens[1].lang).toBe('de')
  })

  it('leaves the copy empty when the locale has none for a slot', () => {
    const [, accounts] = screensFor(project, 'en')
    expect(accounts.headline).toBe('')
    expect(accounts.subhead).toBe('')
  })

  it('never shares the overrides object with the project', () => {
    const [budget] = screensFor(project, 'de')
    expect(budget.overrides).not.toBe(project.set.slots[0].overrides)
  })
})

describe('settingsFor', () => {
  it('lays the set settings over the defaults and takes size and device from the target', () => {
    const s = settingsFor(project, 'play')
    expect(s.sizeId).toBe('android-phone-tall')
    expect(s.deviceId).toBe('pixel-9-pro')
    expect(s.layout).toBe('bleed')
    expect(s.fontId).toBe('inter')
  })

  it('throws on an unknown target', () => {
    expect(() => settingsFor(project, 'nope')).toThrow(/target/)
  })
})

describe('paths', () => {
  it('fills the source template', () => {
    expect(sourcePath(project.set, 'de', 'budget_screen')).toBe('outputs/screenshots/de/budget_screen.png')
  })
  it('fills every occurrence in the source template', () => {
    const set = { ...project.set, sources: 'outputs/{locale}/{screen}/{locale}-{screen}.png' }
    expect(sourcePath(set, 'de', 'budget_screen')).toBe('outputs/de/budget_screen/de-budget_screen.png')
  })
  it('fills the out template with the store locale and a 1-based index', () => {
    expect(outPath(project.set.targets[0], 'de-DE', 1)).toBe('fastlane/screenshots/ios/de-DE/1_de-DE.png')
  })
  it('keys images by locale and screen', () => {
    expect(imageIdFor('de', 'budget_screen')).toBe('de/budget_screen')
  })
})
