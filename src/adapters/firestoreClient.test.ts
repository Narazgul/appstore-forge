import { describe, expect, it } from 'vitest'
import { parseGalleryDoc, parseSetDoc, sourceObjectPath } from './firestoreClient'

const set = {
  version: 1,
  id: 'default',
  targets: [],
  locales: [],
  sources: 's',
  settings: {},
  slots: [],
  approval: null,
}

describe('parseSetDoc', () => {
  it('returns set and copies from a document', () => {
    const p = parseSetDoc({ set, copies: { en: {} }, updatedAt: 'x', updatedBy: 'y' })
    expect(p.set.id).toBe('default')
    expect(p.copies).toEqual({ en: {} })
  })
  it('defaults missing copies to an empty map', () => {
    expect(parseSetDoc({ set }).copies).toEqual({})
  })
  it('throws on a document without a set', () => {
    expect(() => parseSetDoc({ copies: {} })).toThrow(/set/)
    expect(() => parseSetDoc(undefined)).toThrow(/set/)
  })
})

describe('sourceObjectPath', () => {
  it('builds the storage path', () => {
    expect(sourceObjectPath('default', 'de', 'budget_screen')).toBe(
      'backoffice/aso/sources/default/de/budget_screen.png',
    )
  })
})

describe('parseGalleryDoc', () => {
  it('reads the image lists build:aso wrote per locale', () => {
    const g = parseGalleryDoc({ set, gallery: { de: { screens: ['a', 'b'], artwork: ['c'] } } })
    expect(g.de).toEqual({ screens: ['a', 'b'], artwork: ['c'] })
  })

  it('fills in the halves a locale is missing', () => {
    expect(parseGalleryDoc({ gallery: { de: { screens: ['a'] } } }).de).toEqual({
      screens: ['a'],
      artwork: [],
    })
  })

  it('is empty for a set synced before the gallery existed', () => {
    expect(parseGalleryDoc({ set })).toEqual({})
    expect(parseGalleryDoc(undefined)).toEqual({})
  })
})
