import { describe, expect, it } from 'vitest'
import { validateProject } from './validate'
import type { Project } from './types'

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
