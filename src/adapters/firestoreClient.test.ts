import { describe, expect, it } from 'vitest'
import { firestoreProjectStore, parseGalleryDoc, parseSetDoc, sourceObjectPath } from './firestoreClient'
import type { CompatFirebase } from './firestoreClient'
import type { Project } from '../project/types'

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

describe('save across the iframe boundary', () => {
  /**
   * The compat SDK rejects an object whose prototype is not ITS OWN Object.prototype with
   * "Data must be an object, but it was: a custom Object object". The editor sits in an iframe
   * and the SDK in the host page, so every payload built here hit exactly that. A stand-in
   * host realm here: parse() stamps a marker the assertion can look for.
   */
  const hostRealm = {
    parse: (text: string) => Object.assign(JSON.parse(text) as object, { __fromHost: true }),
    stringify: JSON.stringify,
  } as unknown as JSON

  const project: Project = { set: { ...set, version: 1, id: 'default' }, copies: {} }

  const spyFirebase = (written: unknown[]) =>
    ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ set: project.set }) }),
            update: (data: unknown) => {
              written.push(data)
              return Promise.resolve()
            },
            onSnapshot: () => () => undefined,
          }),
        }),
      }),
      storage: () => ({ ref: () => ({ getDownloadURL: () => Promise.reject(new Error('none')) }) }),
      auth: () => ({ currentUser: { email: 'hofi@example.com', getIdToken: () => Promise.resolve('t') } }),
    }) as unknown as CompatFirebase

  it('hands the SDK data built in the host realm, not in this frame', async () => {
    const written: unknown[] = []
    const store = firestoreProjectStore({
      setId: 'default',
      firebase: spyFirebase(written),
      hostJson: hostRealm,
    })
    await store.save(project)
    expect(written).toHaveLength(1)
    expect((written[0] as { __fromHost?: boolean }).__fromHost).toBe(true)
  })

  it('still carries the whole payload through the conversion', async () => {
    const written: unknown[] = []
    const store = firestoreProjectStore({
      setId: 'default',
      firebase: spyFirebase(written),
      hostJson: hostRealm,
    })
    await store.save(project)
    const payload = written[0] as { set: { id: string }; copies: unknown; updatedBy: string }
    expect(payload.set.id).toBe('default')
    expect(payload.copies).toEqual({})
    expect(payload.updatedBy).toBe('hofi@example.com')
  })
})
