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

  it('ignores a slot note, so feedback never makes an approval stale', async () => {
    const p = project()
    p.set.slots[0].note = 'Headline too long'
    expect(await approvalHash(p, bytes('img'))).toBe(await approvalHash(project(), bytes('img')))
  })

  it('changes when a source image changes', async () => {
    expect(await approvalHash(project(), bytes('img2'))).not.toBe(await approvalHash(project(), bytes('img')))
  })

  it('is unchanged for a set that names no artwork, whether or not a reader is passed', async () => {
    expect(await approvalHash(project(), bytes('img'), bytes('art'))).toBe(
      await approvalHash(project(), bytes('img')),
    )
  })

  it('changes when a slot gains an artwork', async () => {
    const p = project()
    p.set.slots[0].artwork = 'pain-points'
    expect(await approvalHash(p, bytes('img'), bytes('art'))).not.toBe(
      await approvalHash(project(), bytes('img'), bytes('art')),
    )
  })

  it('changes when the artwork bytes change, exactly like a screenshot', async () => {
    const p = project()
    p.set.slots[0].artwork = 'pain-points'
    expect(await approvalHash(p, bytes('img'), bytes('art2'))).not.toBe(
      await approvalHash(p, bytes('img'), bytes('art')),
    )
  })

  it('is unchanged for a copy entry that has no eyebrow key, whether or not one is passed explicitly', async () => {
    const withUndefined = project()
    withUndefined.copies.en.a.eyebrow = undefined
    expect(await approvalHash(withUndefined, bytes('img'))).toBe(await approvalHash(project(), bytes('img')))
  })

  it('changes when a slot gains an eyebrow', async () => {
    const p = project()
    p.copies.en.a.eyebrow = 'New'
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(project(), bytes('img')))
  })

  it('is unchanged for a set that names no sticker, whether or not a reader is passed', async () => {
    expect(await approvalHash(project(), bytes('img'), bytes('art'))).toBe(
      await approvalHash(project(), bytes('img')),
    )
  })

  it('changes when a slot gains a sticker', async () => {
    const p = project()
    p.set.slots[0].elements = [{ id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.3 }]
    expect(await approvalHash(p, bytes('img'), bytes('art'))).not.toBe(
      await approvalHash(project(), bytes('img'), bytes('art')),
    )
  })

  it('changes when a sticker moves, through the set JSON alone', async () => {
    const p = project()
    p.set.slots[0].elements = [{ id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.3 }]
    const moved = project()
    moved.set.slots[0].elements = [{ id: 's', artwork: 'dot', x: 0.6, y: 0.5, width: 0.3 }]
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(moved, bytes('img')))
  })

  it('changes when the sticker artwork bytes change, exactly like a screenshot', async () => {
    const p = project()
    p.set.slots[0].elements = [{ id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.3 }]
    expect(await approvalHash(p, bytes('img'), bytes('art2'))).not.toBe(
      await approvalHash(p, bytes('img'), bytes('art')),
    )
  })

  it('never asks for source bytes of an artwork-kind slot, which has no screen to hash', async () => {
    const p = project()
    p.set.slots = [{ id: 'a', kind: 'artwork', overrides: {} }]
    const throwing = async () => {
      throw new Error('should not be called for an artwork-kind slot')
    }
    await expect(approvalHash(p, throwing)).resolves.toMatch(/^[0-9a-f]{64}$/)
  })

  it('still hashes the set JSON change when an artwork slot is added, even with nothing to read', async () => {
    const p = project()
    p.set.slots = [{ id: 'a', kind: 'artwork', overrides: {} }]
    const q = project()
    q.set.slots = [{ id: 'a', kind: 'artwork', overrides: { tilt: 5 } }]
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(q, bytes('img')))
  })

  it('changes when the paired screen changes', async () => {
    const p = project()
    p.set.slots[0].pair = 'other'
    const paired = async (_l: string, screen: string) => new TextEncoder().encode(`img-${screen}`)
    const other = async (_l: string, screen: string) =>
      new TextEncoder().encode(screen === 'other' ? 'moved' : 'img-shot')
    expect(await approvalHash(p, paired)).not.toBe(await approvalHash(p, other))
  })
})
