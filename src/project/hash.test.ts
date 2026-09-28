import { describe, expect, it } from 'vitest'
import { approvalContent, approvalHash, canonicalJson } from './hash'
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

  it('ignores a slot role, so picking one never makes an approval stale', async () => {
    const p = project()
    p.set.slots[0].role = 'hero'
    expect(await approvalHash(p, bytes('img'))).toBe(await approvalHash(project(), bytes('img')))
  })

  it('hashes exactly its text part first: what approvalContent leaves out cannot stale a stamp', () => {
    const p = project()
    p.set.approval = null
    p.set.slots[0].note = 'Headline too long'
    p.set.slots[0].role = 'closer'
    expect(approvalContent(p)).toBe(approvalContent(project()))
    const edited = project()
    edited.set.slots[0].overrides = { tilt: 3 }
    expect(approvalContent(edited)).not.toBe(approvalContent(project()))
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

  it('is unchanged for a copy entry that has no list key, whether or not one is passed explicitly', async () => {
    const withUndefined = project()
    withUndefined.copies.en.a.list = undefined
    expect(await approvalHash(withUndefined, bytes('img'))).toBe(await approvalHash(project(), bytes('img')))
  })

  it('changes when a slot gains a list', async () => {
    const p = project()
    p.copies.en.a.list = ['Budget', 'Sparziele']
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(project(), bytes('img')))
  })

  it('changes when a list entry changes', async () => {
    const p = project()
    p.copies.en.a.list = ['Budget']
    const q = project()
    q.copies.en.a.list = ['Sparziele']
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(q, bytes('img')))
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

  it('is unchanged for a set that names no shape — the exact hash a set had before shapes existed', async () => {
    expect(await approvalHash(project(), bytes('img'), bytes('art'))).toBe(
      await approvalHash(project(), bytes('img')),
    )
  })

  it('changes when a slot gains a shape, through the set JSON alone, with no reader passed at all', async () => {
    const p = project()
    p.set.slots[0].elements = [
      { id: 'kreis', shape: 'circle', color: '#eaf2ff', x: 0.193, y: 0.2, width: 0.666 },
    ]
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(project(), bytes('img')))
  })

  it('never asks for artwork bytes of a shape, which has no image to hash', async () => {
    const p = project()
    p.set.slots[0].elements = [
      { id: 'kreis', shape: 'circle', color: '#eaf2ff', x: 0.193, y: 0.2, width: 0.666 },
    ]
    const throwing = async () => {
      throw new Error('should not be called for a shape')
    }
    await expect(approvalHash(p, bytes('img'), throwing)).resolves.toMatch(/^[0-9a-f]{64}$/)
  })

  it('still asks for a sticker sharing the slot with a shape, but not for the shape', async () => {
    const p = project()
    p.set.slots[0].elements = [
      { id: 'dot', artwork: 'dot', x: 0.5, y: 0.5, width: 0.3 },
      { id: 'kreis', shape: 'circle', color: '#eaf2ff', x: 0.193, y: 0.2, width: 0.666 },
    ]
    const seen: string[] = []
    const artBytes = async (_l: string, artwork: string) => {
      seen.push(artwork)
      return new TextEncoder().encode(artwork)
    }
    await approvalHash(p, bytes('img'), artBytes)
    expect(seen).toEqual(['dot'])
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

  it('is unchanged for a set that names no chip — the exact hash a set had before chips existed', async () => {
    expect(await approvalHash(project(), bytes('img'), bytes('art'))).toBe(
      await approvalHash(project(), bytes('img')),
    )
  })

  it('changes when a slot gains a chip, through the set JSON alone, with no reader passed at all', async () => {
    const p = project()
    p.set.slots[0].elements = [{ id: 'pill', chip: true, x: 0.5, y: 0.2, width: 0.4 }]
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(project(), bytes('img')))
  })

  it('never asks for artwork bytes of a chip, which has no image to hash', async () => {
    const p = project()
    p.set.slots[0].elements = [{ id: 'pill', chip: true, x: 0.5, y: 0.2, width: 0.4 }]
    const throwing = async () => {
      throw new Error('should not be called for a chip')
    }
    await expect(approvalHash(p, bytes('img'), throwing)).resolves.toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when a chip gains copy, through the copies map alone', async () => {
    const p = project()
    p.set.slots[0].elements = [{ id: 'pill', chip: true, x: 0.5, y: 0.2, width: 0.4 }]
    const withText = project()
    withText.set.slots[0].elements = p.set.slots[0].elements
    withText.copies.en.a.chips = { pill: '+312 € saved' }
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(withText, bytes('img')))
  })

  it('is unchanged for a copy entry that has no chips key, whether or not one is passed explicitly', async () => {
    const withUndefined = project()
    withUndefined.copies.en.a.chips = undefined
    expect(await approvalHash(withUndefined, bytes('img'))).toBe(await approvalHash(project(), bytes('img')))
  })

  it('is unchanged for a set that names no mosaic extra, whether or not the reader is passed', async () => {
    expect(await approvalHash(project(), bytes('img'))).toBe(await approvalHash(project(), bytes('img')))
  })

  it('changes when a slot gains a mosaic extra', async () => {
    const p = project()
    p.set.slots[0].extra = ['e1', 'e2', 'e3']
    expect(await approvalHash(p, bytes('img'))).not.toBe(await approvalHash(project(), bytes('img')))
  })

  it('changes when a mosaic extra screen changes bytes, exactly like a screenshot', async () => {
    const p = project()
    p.set.slots[0].extra = ['e1']
    const a = async (_l: string, screen: string) => new TextEncoder().encode(`img-${screen}`)
    const b = async (_l: string, screen: string) =>
      new TextEncoder().encode(screen === 'e1' ? 'moved' : `img-${screen}`)
    expect(await approvalHash(p, a)).not.toBe(await approvalHash(p, b))
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

describe('approvalHash and the canvas offsets', () => {
  /** A set that never used `deviceOffset`/`textOffset`. The literal is what forge v2.10.0, before
   *  either field existed, computes for exactly this project — a set without them must keep it. */
  const plain = (): Project => ({
    set: {
      version: 1,
      id: 'default',
      targets: [
        { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'o/{storeLocale}/{n}.png' },
      ],
      locales: [{ id: 'en', store: { appstore: 'en-US' } }],
      sources: 's/{locale}/{screen}.png',
      settings: { tilt: 4 },
      slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: { layout: 'hero' } }],
      approval: { hash: 'old', by: 'x', at: 'y' },
    },
    copies: { en: { a: { headline: 'Hi', subhead: '' } } },
  })
  const V2_10_0 = '24eb21337bdfc8c5d5df0f5df2bd2325f523d25e4fda4dff03f09ae33aa7af0f'

  it('keeps the exact v2.10.0 hash for a set without them', async () => {
    expect(await approvalHash(plain(), bytes('img'))).toBe(V2_10_0)
  })

  it('treats a key present as undefined like an absent one', async () => {
    const p = plain()
    p.set.slots[0].overrides.deviceOffset = undefined
    p.set.settings.textOffset = undefined
    expect(await approvalHash(p, bytes('img'))).toBe(V2_10_0)
  })

  it('changes once a tile carries one, set-wide or per slot', async () => {
    const slot = plain()
    slot.set.slots[0].overrides.textOffset = { dx: 0.01, dy: 0 }
    const set = plain()
    set.set.settings.deviceOffset = { dx: 0, dy: 0.02 }
    const hashes = await Promise.all([slot, set].map((p) => approvalHash(p, bytes('img'))))
    expect(hashes[0]).not.toBe(V2_10_0)
    expect(hashes[1]).not.toBe(V2_10_0)
    expect(hashes[0]).not.toBe(hashes[1])
  })
})
