import { describe, expect, it } from 'vitest'
import { firestoreProjectStore, parseGalleryDoc, parseSetDoc, sourceObjectPath } from './firestoreClient'
import type { CompatFirebase } from './firestoreClient'
import type { Project, ProjectSet } from '../project/types'

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

describe('load resolves sticker artwork like a slot`s own', () => {
  const stickerProject = {
    ...set,
    locales: [{ id: 'en', store: {} }],
    slots: [
      {
        id: 'a',
        kind: 'screen' as const,
        screen: 'shot',
        overrides: {},
        elements: [{ id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.3 }],
      },
    ],
  }

  const firebaseFor = (data: unknown) =>
    ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => data }) }),
        }),
      }),
      storage: () => ({
        ref: (path: string) => ({ getDownloadURL: () => Promise.resolve(`https://cdn/${path}`) }),
      }),
      auth: () => ({ currentUser: null }),
    }) as unknown as CompatFirebase

  it('resolves the sticker artwork url even before the gallery lists it', async () => {
    const store = firestoreProjectStore({ setId: 'default', firebase: firebaseFor({ set: stickerProject }) })
    await store.load()
    expect(store.artworkUrl?.('en', 'dot')).toBe('https://cdn/backoffice/aso/artwork/default/en/dot.png')
  })

  it('never asks Storage to resolve a shape, which has no image at all', async () => {
    const shapeProject = {
      ...set,
      locales: [{ id: 'en', store: {} }],
      slots: [
        {
          id: 'a',
          kind: 'screen' as const,
          screen: 'shot',
          overrides: {},
          elements: [
            { id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.3 },
            { id: 'kreis', shape: 'circle' as const, color: '#eaf2ff', x: 0.193, y: 0.2, width: 0.666 },
          ],
        },
      ],
    }
    const requested: string[] = []
    const firebase = {
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => ({ set: shapeProject }) }) }),
        }),
      }),
      storage: () => ({
        ref: (path: string) => {
          requested.push(path)
          return { getDownloadURL: () => Promise.resolve(`https://cdn/${path}`) }
        },
      }),
      auth: () => ({ currentUser: null }),
    } as unknown as CompatFirebase
    const store = firestoreProjectStore({ setId: 'default', firebase })
    await store.load()
    expect(requested.some((p) => p.includes('kreis'))).toBe(false)
    expect(store.artworkUrl?.('en', 'dot')).toBe('https://cdn/backoffice/aso/artwork/default/en/dot.png')
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

/** A small in-memory stand-in for the sets collection, so `listSets`/`createSet`/`save` can be
 *  driven end to end without a real Firestore. `update` only merges the keys it is given, exactly
 *  like the real compat SDK — which is what lets a field outside the payload (`sourcesFrom`,
 *  `gallery`) survive a save untouched. */
function fakeFirestore(initialDocs: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map<string, Record<string, unknown>>(Object.entries(initialDocs))
  const requestedPaths: string[] = []
  const firebase = {
    firestore: () => ({
      collection: () => ({
        doc: (id: string) => ({
          get: () => Promise.resolve({ exists: docs.has(id), data: () => docs.get(id) }),
          set: (data: unknown) => {
            docs.set(id, data as Record<string, unknown>)
            return Promise.resolve()
          },
          update: (data: unknown) => {
            docs.set(id, { ...(docs.get(id) ?? {}), ...(data as Record<string, unknown>) })
            return Promise.resolve()
          },
          onSnapshot: () => () => undefined,
        }),
        get: () => Promise.resolve({ docs: [...docs.keys()].sort().map((id) => ({ id })) }),
      }),
    }),
    storage: () => ({
      ref: (path: string) => {
        requestedPaths.push(path)
        return { getDownloadURL: () => Promise.resolve(`https://cdn/${path}`) }
      },
    }),
    auth: () => ({ currentUser: { email: 'hofi@example.com', getIdToken: () => Promise.resolve('t') } }),
  } as unknown as CompatFirebase
  return { firebase, docs, requestedPaths }
}

const hostRealm2 = {
  parse: (text: string) => Object.assign(JSON.parse(text) as object, { __fromHost: true }),
  stringify: JSON.stringify,
} as unknown as JSON

const projectWith = (id: string, screen = 'shot'): ProjectSet => ({
  ...set,
  version: 1,
  id,
  locales: [{ id: 'en', store: {} }],
  slots: [{ id: 'a', kind: 'screen', screen, overrides: {} }],
})

describe('listSets', () => {
  it('lists every doc id in the collection, sorted', async () => {
    const { firebase } = fakeFirestore({
      default: { set: projectWith('default') },
      promo: { set: projectWith('promo') },
      abc: { set: projectWith('abc') },
    })
    const store = firestoreProjectStore({ setId: 'default', firebase })
    await expect(store.listSets?.()).resolves.toEqual(['abc', 'default', 'promo'])
  })
})

describe('createSet', () => {
  it('refuses to overwrite a set that already exists', async () => {
    const { firebase } = fakeFirestore({
      default: { set: projectWith('default') },
      promo: { set: projectWith('promo') },
    })
    const store = firestoreProjectStore({ setId: 'default', firebase, hostJson: hostRealm2 })
    await store.load()
    await expect(store.createSet?.({ set: projectWith('promo'), copies: {} })).rejects.toThrow(
      /already exists/,
    )
  })

  it('writes set/copies/gallery/sourcesFrom with a host-realm payload, via a full set()', async () => {
    const { firebase, docs } = fakeFirestore({
      default: { set: projectWith('default'), gallery: { en: { screens: ['shot'], artwork: [] } } },
    })
    const store = firestoreProjectStore({ setId: 'default', firebase, hostJson: hostRealm2 })
    await store.load()
    await store.createSet?.({
      set: projectWith('promo'),
      copies: { en: { a: { headline: 'Hi', subhead: '' } } },
    })
    const written = docs.get('promo') as Record<string, unknown>
    expect(written.__fromHost).toBe(true)
    expect((written.set as { id: string }).id).toBe('promo')
    expect(written.copies).toEqual({ en: { a: { headline: 'Hi', subhead: '' } } })
    expect(written.gallery).toEqual({ en: { screens: ['shot'], artwork: [] } })
    expect(written.sourcesFrom).toBe('default')
    expect(written.updatedBy).toBe('hofi@example.com')
  })

  it('never chains sourcesFrom: duplicating a duplicate still points at the original', async () => {
    const { firebase, docs } = fakeFirestore({
      copy1: { set: projectWith('copy1'), sourcesFrom: 'original' },
    })
    const store = firestoreProjectStore({ setId: 'copy1', firebase, hostJson: hostRealm2 })
    await store.load()
    await store.createSet?.({ set: projectWith('copy2'), copies: {} })
    expect((docs.get('copy2') as Record<string, unknown>).sourcesFrom).toBe('original')
  })
})

describe('sourcesFrom resolves images under the original set', () => {
  it('resolves source and artwork URLs under sourcesFrom, not the duplicate’s own id', async () => {
    const duplicateSet: ProjectSet = {
      ...projectWith('copy1', 'shot'),
      slots: [
        {
          id: 'a',
          kind: 'screen',
          screen: 'shot',
          overrides: {},
          artwork: 'badge',
        },
      ],
    }
    const { firebase, requestedPaths } = fakeFirestore({
      copy1: { set: duplicateSet, sourcesFrom: 'original' },
    })
    const store = firestoreProjectStore({ setId: 'copy1', firebase })
    await store.load()
    expect(store.sourceUrl('en', 'shot')).toBe('https://cdn/backoffice/aso/sources/original/en/shot.png')
    expect(store.artworkUrl?.('en', 'badge')).toBe('https://cdn/backoffice/aso/artwork/original/en/badge.png')
    expect(requestedPaths).toContain('backoffice/aso/sources/original/en/shot.png')
    expect(requestedPaths.some((p) => p.includes('/copy1/'))).toBe(false)
  })

  it('without sourcesFrom, resolves under the set’s own id as before', async () => {
    const { firebase } = fakeFirestore({ default: { set: projectWith('default') } })
    const store = firestoreProjectStore({ setId: 'default', firebase })
    await store.load()
    expect(store.sourceUrl('en', 'shot')).toBe('https://cdn/backoffice/aso/sources/default/en/shot.png')
  })
})

describe('save keeps sourcesFrom (update never touches fields outside its payload)', () => {
  it('a duplicated set keeps its sourcesFrom after an ordinary save', async () => {
    const { firebase, docs } = fakeFirestore({
      promo: {
        set: projectWith('promo'),
        sourcesFrom: 'default',
        gallery: { en: { screens: [], artwork: [] } },
      },
    })
    const store = firestoreProjectStore({ setId: 'promo', firebase, hostJson: hostRealm2 })
    const project = await store.load()
    await store.save({ ...project, copies: { en: { a: { headline: 'Edited', subhead: '' } } } })
    const after = docs.get('promo') as Record<string, unknown>
    expect(after.sourcesFrom).toBe('default')
    expect(after.gallery).toEqual({ en: { screens: [], artwork: [] } })
    expect((after.copies as Record<string, unknown>).en).toEqual({ a: { headline: 'Edited', subhead: '' } })
  })
})
