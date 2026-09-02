import { describe, expect, it } from 'vitest'
import { approvalHash, canonicalJson } from './hash'
import type { Project } from './types'

const project = (): Project => ({
  set: {
    version: 1,
    id: 'default',
    targets: [
      { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'o/{storeLocale}/{n}.png' },
    ],
    locales: [{ id: 'en', store: { appstore: 'en-US' } }],
    sources: 's/{locale}/{screen}.png',
    settings: {},
    slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
    approval: { hash: 'old', by: 'x', at: 'y' },
  },
  copies: { en: { a: { headline: 'Hi', subhead: '' } } },
})
const bytes = (s: string) => async () => new TextEncoder().encode(s)

describe('canonicalJson', () => {
  it('sorts keys recursively so key order cannot change the hash', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })
})

describe('approvalHash', () => {
  it('is a 64 char hex string and stable across calls', async () => {
    const a = await approvalHash(project(), bytes('img'))
    const b = await approvalHash(project(), bytes('img'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
  })

  it('ignores the approval field itself', async () => {
    const p = project()
    p.set.approval = null
    expect(await approvalHash(p, bytes('img'))).toBe(await approvalHash(project(), bytes('img')))
  })

  it('changes when copy changes', async () => {
    const p = project()
    p.copies.en.a.headline = 'Changed'
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(project(), bytes('img')))
  })

  it('changes when a source image changes', async () => {
    expect(await approvalHash(project(), bytes('img2'))).not.toBe(await approvalHash(project(), bytes('img')))
  })
})
