import { describe, expect, it } from 'vitest'
import { validateProject } from './validate'
import type { Project, ProjectLocale, SlotCopy } from './types'

const base = (): Project => ({
  set: {
    version: 1,
    id: 'default',
    targets: [
      { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'out/{storeLocale}/{n}.png' },
    ],
    locales: [{ id: 'en', store: { appstore: 'en-US' } }],
    sources: 'src/{locale}/{screen}.png',
    settings: {},
    slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
    approval: null,
  },
  copies: { en: { a: { headline: 'Hi', subhead: '' } } },
})
const always = () => true

describe('validateProject', () => {
  it('passes a complete project', () => {
    expect(validateProject(base(), always)).toEqual([])
  })

  it('flags a missing source image as an error with slot and locale', () => {
    const issues = validateProject(base(), () => false)
    expect(issues).toEqual([
      { level: 'error', message: 'Source image missing: src/en/shot.png', slot: 'a', locale: 'en' },
    ])
  })

  it('flags a slot without headline for a locale', () => {
    const p = base()
    p.copies.en = {}
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Headline missing',
      slot: 'a',
      locale: 'en',
    })
  })

  it('flags a copy entry without a headline instead of crashing', () => {
    const p = base()
    p.copies.en.a = { subhead: '' } as SlotCopy
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Headline missing',
      slot: 'a',
      locale: 'en',
    })
  })

  it('flags a locale without a store map instead of crashing', () => {
    const p = base()
    delete (p.set.locales[0] as Partial<ProjectLocale>).store
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'No store locale for target appstore',
      locale: 'en',
    })
  })

  it('flags copy for a slot that does not exist', () => {
    const p = base()
    p.copies.en.ghost = { headline: 'x', subhead: '' }
    expect(validateProject(p, always)).toContainEqual({
      level: 'warn',
      message: 'Copy for unknown slot',
      slot: 'ghost',
      locale: 'en',
    })
  })

  it('flags a locale without a store code for a target', () => {
    const p = base()
    p.set.locales[0].store = {}
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'No store locale for target appstore',
      locale: 'en',
    })
  })

  it('flags unknown size, device and duplicate slot ids', () => {
    const p = base()
    p.set.targets[0].sizeId = 'nope'
    p.set.targets[0].deviceId = 'nope'
    p.set.slots.push({ id: 'a', kind: 'screen', screen: 'shot', overrides: {} })
    const messages = validateProject(p, always).map((i) => i.message)
    expect(messages).toContain('Unknown size nope')
    expect(messages).toContain('Unknown device nope')
    expect(messages).toContain('Duplicate slot id a')
  })

  it('reports an open note as a warning', () => {
    const p = base()
    p.set.slots[0].note = ' Headline too long '
    expect(validateProject(p, always)).toEqual([
      { level: 'warn', message: 'Open feedback: Headline too long', slot: 'a' },
    ])
  })

  it('stays silent on an empty note', () => {
    const p = base()
    p.set.slots[0].note = '   '
    expect(validateProject(p, always)).toEqual([])
  })

  it('flags a slot whose arrangement needs an artwork but names none', () => {
    const p = base()
    p.set.slots[0].overrides = { positionId: 'duo-artwork' }
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Arrangement duo-artwork needs an artwork, but the slot names none',
      slot: 'a',
    })
  })

  it('takes the arrangement from the set settings when the slot overrides nothing', () => {
    const p = base()
    p.set.settings = { positionId: 'duo-artwork' }
    expect(validateProject(p, always).map((i) => i.message)).toContain(
      'Arrangement duo-artwork needs an artwork, but the slot names none',
    )
  })

  it('flags an artwork file that is not there', () => {
    const p = base()
    p.set.slots[0].artwork = 'pain-points'
    expect(validateProject(p, always, () => false)).toContainEqual({
      level: 'error',
      message: 'Artwork image missing: aso/artwork/pain-points.png',
      slot: 'a',
    })
  })

  it('names the language too when the artwork template is per-language', () => {
    const p = base()
    p.set.artworkSources = 'art/{locale}/{artwork}.png'
    p.set.slots[0].artwork = 'pain-points'
    expect(validateProject(p, always, () => false)).toContainEqual({
      level: 'error',
      message: 'Artwork image missing: art/en/pain-points.png',
      slot: 'a',
      locale: 'en',
    })
  })

  it('accepts a slot whose artwork is there', () => {
    const p = base()
    p.set.slots[0].artwork = 'pain-points'
    p.set.slots[0].overrides = { positionId: 'duo-artwork' }
    expect(validateProject(p, always, always)).toEqual([])
  })

  it('insists on an {artwork} placeholder in the template', () => {
    const p = base()
    p.set.artworkSources = 'aso/artwork/fixed.png'
    expect(validateProject(p, always).map((i) => i.message)).toContain(
      'artworkSources must contain {artwork}',
    )
  })

  it('flags a missing source for the paired screen', () => {
    const p = base()
    p.set.slots[0].pair = 'other'
    expect(validateProject(p, (_l, screen) => screen !== 'other')).toContainEqual({
      level: 'error',
      message: 'Source image missing: src/en/other.png',
      slot: 'a',
      locale: 'en',
    })
  })

  it('accepts a pair whose source is there', () => {
    const p = base()
    p.set.slots[0].pair = 'other'
    expect(validateProject(p, always)).toEqual([])
  })

  it('rejects artwork slots until they are implemented', () => {
    const p = base()
    p.set.slots[0].kind = 'artwork'
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Slot kind artwork is not supported yet',
      slot: 'a',
    })
  })
})
