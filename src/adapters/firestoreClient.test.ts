import { describe, expect, it } from 'vitest'
import { parseSetDoc, sourceObjectPath } from './firestoreClient'

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
