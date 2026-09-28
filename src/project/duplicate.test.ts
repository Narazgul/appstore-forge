import { describe, expect, it } from 'vitest'
import { duplicateProject, rewriteTargetOut, SET_ID_RE } from './duplicate'
import { validateProject } from './validate'
import type { Project } from './types'

const twoTargetProject = (): Project => ({
  set: {
    version: 1,
    id: 'default',
    targets: [
      {
        id: 'appstore',
        sizeId: 'iphone-6-9',
        deviceId: 'iphone-17-pro',
        out: 'store/ios/{storeLocale}/{n}.png',
      },
      {
        id: 'play',
        sizeId: 'android-phone',
        deviceId: 'pixel-9-pro',
        out: 'store/play/{storeLocale}/{n}.png',
      },
    ],
    locales: [
      { id: 'en', store: { appstore: 'en-US', play: 'en-US' } },
      { id: 'de', store: { appstore: 'de-DE', play: 'de-DE' } },
    ],
    sources: 'screenshots/{locale}/{screen}.png',
    artworkSources: 'aso/artwork/{artwork}.png',
    settings: { background: { kind: 'solid', color: '#eaf2ff' } },
    slots: [
      {
        id: 'a',
        kind: 'screen',
        screen: 'shot-a',
        overrides: { layout: 'text-top' },
        elements: [{ id: 'dot', artwork: 'dot', x: 0.5, y: 0.5, width: 0.2 }],
        note: 'reshoot this one',
        role: 'hero',
      },
      { id: 'b', kind: 'screen', screen: 'shot-b', overrides: {} },
    ],
    approval: { hash: 'abc', by: 'hofi', at: '2026-01-01T00:00:00.000Z' },
  },
  copies: {
    en: {
      a: { headline: 'Hello *world*', subhead: 'sub', eyebrow: 'NEW' },
      b: { headline: 'Second', subhead: '' },
    },
    de: {
      a: { headline: 'Hallo *Welt*', subhead: 'unter', eyebrow: 'NEU' },
      b: { headline: 'Zweitens', subhead: '' },
    },
  },
})

const featureGraphicProject = (): Project => ({
  set: {
    version: 1,
    id: 'default',
    targets: [
      {
        id: 'play-feature',
        sizeId: 'android-feature',
        deviceId: 'iphone-17-pro',
        out: 'store/play/feature-graphic.png',
      },
    ],
    locales: [{ id: 'en', store: { 'play-feature': 'en-US' } }],
    sources: 'screenshots/{locale}/{screen}.png',
    settings: {},
    slots: [{ id: 'hero', kind: 'artwork', overrides: {} }],
    approval: null,
  },
  copies: { en: { hero: { headline: 'Feature', subhead: '' } } },
})

describe('rewriteTargetOut', () => {
  it('rewrites a multi-tile out, keeping the {n}.ext shape under the new folder', () => {
    expect(rewriteTargetOut('store/ios/{storeLocale}/{n}.png', 'promo', 'appstore')).toBe(
      'outputs/cpp/promo/appstore/{storeLocale}/{n}.png',
    )
  })

  it('rewrites a single-tile out (no {n}), keeping the original file name', () => {
    expect(rewriteTargetOut('store/play/feature-graphic.png', 'promo', 'play-feature')).toBe(
      'outputs/cpp/promo/play-feature/{storeLocale}/feature-graphic.png',
    )
  })
})

describe('SET_ID_RE', () => {
  it('accepts lowercase alphanumeric ids with hyphens', () => {
    expect(SET_ID_RE.test('promo')).toBe(true)
    expect(SET_ID_RE.test('promo-2026')).toBe(true)
    expect(SET_ID_RE.test('a')).toBe(true)
  })
  it('rejects anything else', () => {
    expect(SET_ID_RE.test('')).toBe(false)
    expect(SET_ID_RE.test('-promo')).toBe(false)
    expect(SET_ID_RE.test('Promo')).toBe(false)
    expect(SET_ID_RE.test('promo_2026')).toBe(false)
    expect(SET_ID_RE.test('a'.repeat(41))).toBe(false)
  })
})

describe('duplicateProject', () => {
  it('gives the new set the requested id and clears approval', () => {
    const result = duplicateProject(twoTargetProject(), 'promo')
    expect(result.set.id).toBe('promo')
    expect(result.set.approval).toBeNull()
  })

  it('rewrites every target out to the cpp folder, per target id', () => {
    const result = duplicateProject(twoTargetProject(), 'promo')
    expect(result.set.targets.map((t) => t.out)).toEqual([
      'outputs/cpp/promo/appstore/{storeLocale}/{n}.png',
      'outputs/cpp/promo/play/{storeLocale}/{n}.png',
    ])
  })

  it('keeps the single-tile shape without adding {n}', () => {
    const result = duplicateProject(featureGraphicProject(), 'promo')
    expect(result.set.targets[0].out).toBe('outputs/cpp/promo/play-feature/{storeLocale}/feature-graphic.png')
  })

  it('carries copy for every locale, including eyebrow', () => {
    const result = duplicateProject(twoTargetProject(), 'promo')
    expect(result.copies.en.a).toEqual({ headline: 'Hello *world*', subhead: 'sub', eyebrow: 'NEW' })
    expect(result.copies.de.a).toEqual({ headline: 'Hallo *Welt*', subhead: 'unter', eyebrow: 'NEU' })
    expect(result.copies.en.b).toEqual({ headline: 'Second', subhead: '' })
  })

  it('keeps stickers, slot notes and a slot role', () => {
    const result = duplicateProject(twoTargetProject(), 'promo')
    expect(result.set.slots[0].elements).toEqual([{ id: 'dot', artwork: 'dot', x: 0.5, y: 0.5, width: 0.2 }])
    expect(result.set.slots[0].note).toBe('reshoot this one')
    expect(result.set.slots[0].role).toBe('hero')
  })

  it('deep copies: mutating the duplicate never touches the original', () => {
    const original = twoTargetProject()
    const result = duplicateProject(original, 'promo')
    result.set.slots[0].overrides.layout = 'hero'
    result.copies.en.a.headline = 'Mutated'
    result.set.settings.background = { kind: 'solid', color: '#000000' }
    result.set.slots[0].elements![0].x = 0.9
    expect(original.set.slots[0].overrides.layout).toBe('text-top')
    expect(original.copies.en.a.headline).toBe('Hello *world*')
    expect(original.set.settings.background).toEqual({ kind: 'solid', color: '#eaf2ff' })
    expect(original.set.slots[0].elements![0].x).toBe(0.5)
  })

  it('produces a project that still validates (the kept slot note is a warning, not an error)', () => {
    const result = duplicateProject(twoTargetProject(), 'promo')
    const issues = validateProject(
      result,
      () => true,
      () => true,
    )
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })
})
