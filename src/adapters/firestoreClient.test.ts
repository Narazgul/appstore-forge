import { describe, expect, it } from 'vitest'
import {
  backgroundObjectPath,
  firestoreProjectStore,
  nodesObjectPath,
  parseBackgroundsDoc,
  parseGalleryDoc,
  parseGuidelinesDoc,
  parseSetDoc,
  sourceObjectPath,
} from './firestoreClient'
import type { CompatFirebase } from './firestoreClient'
import { approvalHash } from '../project/hash'
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
  it('carries a slot’s chip copy through unchanged, alongside headline and subhead', () => {
    const copies = { en: { a: { headline: 'Hi', subhead: '', chips: { pill: '+312 € saved' } } } }
    const p = parseSetDoc({ set, copies })
    expect(p.copies.en.a.chips).toEqual({ pill: '+312 € saved' })
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
    expect(store.artworkUrl?.('en', 'dot')).toBe('https://cdn/backoffice/aso/artwork/default/dot.png')
  })

  it('keeps a locale folder when the artwork path names one', async () => {
    const perLocale = { ...stickerProject, artworkSources: 'art/{locale}/{artwork}.png' }
    const store = firestoreProjectStore({ setId: 'default', firebase: firebaseFor({ set: perLocale }) })
    await store.load()
    expect(store.artworkUrl?.('en', 'dot')).toBe('https://cdn/backoffice/aso/artwork/default/en/dot.png')
  })

  it('asks Storage once for an artwork shared by all languages and serves it to each', async () => {
    const requested: string[] = []
    const firebase = {
      ...firebaseFor({}),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: () =>
              Promise.resolve({
                exists: true,
                data: () => ({
                  set: {
                    ...stickerProject,
                    locales: [
                      { id: 'de', store: {} },
                      { id: 'en', store: {} },
                    ],
                  },
                }),
              }),
          }),
        }),
      }),
      storage: () => ({
        ref: (path: string) => {
          requested.push(path)
          return { getDownloadURL: () => Promise.resolve(`https://cdn/${path}`) }
        },
      }),
    } as unknown as CompatFirebase
    const store = firestoreProjectStore({ setId: 'default', firebase })
    await store.load()
    expect(requested.filter((p) => p.includes('/artwork/'))).toEqual([
      'backoffice/aso/artwork/default/dot.png',
    ])
    expect(store.artworkUrl?.('de', 'dot')).toBe('https://cdn/backoffice/aso/artwork/default/dot.png')
    expect(store.artworkUrl?.('en', 'dot')).toBe('https://cdn/backoffice/aso/artwork/default/dot.png')
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
    expect(store.artworkUrl?.('en', 'dot')).toBe('https://cdn/backoffice/aso/artwork/default/dot.png')
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

  it('carries a chip’s text through the save payload — the adapter passes copy through generically', async () => {
    const written: unknown[] = []
    const store = firestoreProjectStore({
      setId: 'default',
      firebase: spyFirebase(written),
      hostJson: hostRealm,
    })
    const withChip: Project = {
      ...project,
      copies: { en: { a: { headline: 'Hi', subhead: '', chips: { pill: '+312 € saved' } } } },
    }
    await store.save(withChip)
    const payload = written[0] as { copies: { en: { a: { chips?: Record<string, string> } } } }
    expect(payload.copies.en.a.chips).toEqual({ pill: '+312 € saved' })
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
    expect(store.artworkUrl?.('en', 'badge')).toBe('https://cdn/backoffice/aso/artwork/original/badge.png')
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

  it('a slot role survives a load/save round trip, generically, like any other slot field', async () => {
    const withRole = { ...projectWith('promo'), slots: [{ ...projectWith('promo').slots[0], role: 'hero' }] }
    const { firebase, docs } = fakeFirestore({ promo: { set: withRole, copies: {} } })
    const store = firestoreProjectStore({ setId: 'promo', firebase, hostJson: hostRealm2 })
    const project = await store.load()
    expect(project.set.slots[0].role).toBe('hero')

    await store.save(project)
    const after = docs.get('promo') as { set: { slots: { role?: string }[] } }
    expect(after.set.slots[0].role).toBe('hero')
  })
})

describe('the canvas offsets through Firestore', () => {
  /** Counts every `set()` so the test can prove a save only ever `update`s (see `save`). */
  const counting = (initial: Record<string, Record<string, unknown>>) => {
    const fake = fakeFirestore(initial)
    let setCalls = 0
    const collection = fake.firebase.firestore().collection('')
    const firebase = {
      ...fake.firebase,
      firestore: () => ({
        collection: () => ({
          ...collection,
          doc: (id: string) => {
            const doc = collection.doc(id)
            return {
              ...doc,
              set: (data: unknown) => {
                setCalls++
                return doc.set(data)
              },
            }
          },
        }),
      }),
    } as unknown as CompatFirebase
    return { firebase, docs: fake.docs, setCalls: () => setCalls }
  }

  const withOffsets = (): Project => ({
    set: {
      ...projectWith('default'),
      settings: { textOffset: { dx: 0, dy: 0.02 } },
      slots: [
        {
          id: 'a',
          kind: 'screen',
          screen: 'shot',
          overrides: {
            layout: 'hero',
            deviceOffset: { dx: 0.0762, dy: -0.0351 },
            textOffset: { dx: -0.03, dy: 0 },
          },
        },
      ],
    },
    copies: {},
  })

  it('writes both offsets with update, never set, and reads them back unchanged', async () => {
    const { firebase, docs, setCalls } = counting({
      default: {
        set: projectWith('default'),
        copies: {},
        gallery: { en: { screens: ['shot'], artwork: [] } },
      },
    })
    const store = firestoreProjectStore({ setId: 'default', firebase, hostJson: hostRealm2 })
    await store.load()
    await store.save(withOffsets())
    expect(setCalls()).toBe(0)
    const back = await firestoreProjectStore({ setId: 'default', firebase }).load()
    expect(back.set.slots[0].overrides).toEqual(withOffsets().set.slots[0].overrides)
    expect(back.set.settings.textOffset).toEqual({ dx: 0, dy: 0.02 })
    // The gallery belongs to the sync; the GUI's save must leave it where it was.
    expect(docs.get('default')!.gallery).toEqual({ en: { screens: ['shot'], artwork: [] } })
  })

  it('drops an offset the GUI removed — the set field is replaced whole, not merged', async () => {
    const { firebase } = counting({ default: { set: withOffsets().set, copies: {} } })
    const store = firestoreProjectStore({ setId: 'default', firebase, hostJson: hostRealm2 })
    const project = await store.load()
    const { deviceOffset: _gone, ...rest } = project.set.slots[0].overrides
    await store.save({
      ...project,
      set: { ...project.set, settings: {}, slots: [{ ...project.set.slots[0], overrides: rest }] },
    })
    const back = await firestoreProjectStore({ setId: 'default', firebase }).load()
    expect(back.set.slots[0].overrides).toEqual({ layout: 'hero', textOffset: { dx: -0.03, dy: 0 } })
    expect(back.set.settings).toEqual({})
  })
})

describe('nodes and background images', () => {
  const withImage = {
    ...set,
    locales: [{ id: 'en', store: {} }],
    settings: {
      background: { kind: 'solid', color: '#5a665e', image: { src: 'aso/hintergruende/wiese.jpg' } },
    },
    slots: [{ id: 'a', kind: 'screen' as const, screen: 'shot', overrides: {} }],
  }

  const firebaseFor = (data: unknown, requested: string[] = []) =>
    ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => data }) }),
        }),
      }),
      storage: () => ({
        ref: (path: string) => {
          requested.push(path)
          return {
            getDownloadURL: () =>
              path.includes('fehlt')
                ? Promise.reject(new Error('404'))
                : Promise.resolve(`https://cdn/${path}`),
          }
        },
      }),
      auth: () => ({ currentUser: null }),
    }) as unknown as CompatFirebase

  it('names the storage paths after what aso-sync uploads', () => {
    expect(nodesObjectPath('default', 'de', 'budget')).toBe('backoffice/aso/nodes/default/de/budget.json')
    expect(backgroundObjectPath('aso/hintergruende/wiese.jpg')).toBe(
      'backoffice/aso/backgrounds/aso/hintergruende/wiese.jpg',
    )
  })

  it('reads the picker list, dropping entries without a src', () => {
    expect(
      parseBackgroundsDoc({
        backgrounds: [{ src: 'a.jpg', average: '#000000' }, { average: '#fff' }, { src: 'b.png' }],
      }),
    ).toEqual([{ src: 'a.jpg', average: '#000000' }, { src: 'b.png' }])
    expect(parseBackgroundsDoc({ set })).toEqual([])
  })

  it('resolves the set’s own background and every listed one, each once', async () => {
    const requested: string[] = []
    const store = firestoreProjectStore({
      setId: 'default',
      firebase: firebaseFor(
        {
          set: withImage,
          backgrounds: [{ src: 'aso/hintergruende/wiese.jpg' }, { src: 'aso/hintergruende/feld.jpg' }],
        },
        requested,
      ),
    })
    await store.load()
    expect(store.backgroundUrl!('aso/hintergruende/wiese.jpg')).toBe(
      'https://cdn/backoffice/aso/backgrounds/aso/hintergruende/wiese.jpg',
    )
    expect(store.backgroundUrl!('aso/hintergruende/feld.jpg')).toBe(
      'https://cdn/backoffice/aso/backgrounds/aso/hintergruende/feld.jpg',
    )
    expect(requested.filter((p) => p.endsWith('wiese.jpg'))).toHaveLength(1)
    expect(store.backgroundGallery!()).toHaveLength(2)
  })

  it('fetches background and nodes bytes, nodes from the set the images live under', async () => {
    const fetched: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((url: string) => {
      fetched.push(url)
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
    }) as typeof fetch
    try {
      const store = firestoreProjectStore({
        setId: 'kopie',
        firebase: firebaseFor({ set: withImage, sourcesFrom: 'default' }),
      })
      await store.load()
      expect(await store.backgroundBytes!('aso/hintergruende/wiese.jpg')).toEqual(new Uint8Array([1, 2, 3]))
      expect(await store.nodesBytes!('en', 'shot')).toEqual(new Uint8Array([1, 2, 3]))
      expect(fetched).toEqual([
        'https://cdn/backoffice/aso/backgrounds/aso/hintergruende/wiese.jpg',
        'https://cdn/backoffice/aso/nodes/default/en/shot.json',
      ])
      await expect(store.nodesBytes!('en', 'fehlt')).rejects.toThrow(/Nodes missing/)
      await expect(store.backgroundBytes!('aso/hintergruende/andere.jpg')).rejects.toThrow(
        /Background missing/,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('approval hash through Firestore', () => {
  it('equals the hash the CLI computes from the files, for a set with a background image and a node effect', async () => {
    const project: Project = {
      set: {
        ...set,
        locales: [{ id: 'en', store: {} }],
        sources: 'studio/aufnahmen/{locale}/{screen}.png',
        settings: {
          background: { kind: 'solid', color: '#5a665e', image: { src: 'studio/hintergruende/wiese.jpg' } },
        },
        slots: [
          {
            id: 'a',
            kind: 'screen',
            screen: 'budget',
            overrides: {},
            elements: [{ id: 'l', effect: 'lift', node: 'Miete' }],
          },
        ],
      } as ProjectSet,
      copies: { en: { a: { headline: 'Hi', subhead: '' } } },
    }
    const files: Record<string, Uint8Array> = {
      'studio/aufnahmen/en/budget.png': new Uint8Array([1, 1]),
      'studio/aufnahmen/en/budget.nodes.json': new Uint8Array([2, 2]),
      'studio/hintergruende/wiese.jpg': new Uint8Array([3, 3]),
    }
    const storage: Record<string, Uint8Array> = {
      [sourceObjectPath('default', 'en', 'budget')]: files['studio/aufnahmen/en/budget.png'],
      [nodesObjectPath('default', 'en', 'budget')]: files['studio/aufnahmen/en/budget.nodes.json'],
      [backgroundObjectPath('studio/hintergruende/wiese.jpg')]: files['studio/hintergruende/wiese.jpg'],
    }
    const firebase = {
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => project }) }),
        }),
      }),
      storage: () => ({
        ref: (path: string) => ({
          getDownloadURL: () =>
            storage[path] ? Promise.resolve(`mem://${path}`) : Promise.reject(new Error('404')),
        }),
      }),
      auth: () => ({ currentUser: null }),
    } as unknown as CompatFirebase
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((url: string) =>
      Promise.resolve(new Response(storage[url.slice('mem://'.length)] as BodyInit))) as typeof fetch
    try {
      const store = firestoreProjectStore({ setId: 'default', firebase })
      await store.load()
      const viaFirestore = await approvalHash(
        project,
        (l, s) => store.sourceBytes(l, s),
        store.artworkBytes!.bind(store),
        (l, s) => store.nodesBytes!(l, s).catch(() => new Uint8Array()),
        store.backgroundBytes!.bind(store),
      )
      const fromFiles = await approvalHash(
        project,
        async (l, s) => files[`studio/aufnahmen/${l}/${s}.png`],
        async () => new Uint8Array(),
        async (l, s) => files[`studio/aufnahmen/${l}/${s}.nodes.json`] ?? new Uint8Array(),
        async (src) => files[src],
      )
      expect(viaFirestore).toBe(fromFiles)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('guidelines', () => {
  it('reads the text build:aso mirrored, and nothing from an older doc', () => {
    expect(parseGuidelinesDoc({ set, guidelines: '# Guidelines\n' })).toBe('# Guidelines\n')
    expect(parseGuidelinesDoc({ set })).toBeNull()
    expect(parseGuidelinesDoc({ set, guidelines: 3 })).toBeNull()
  })

  it('loads them with the set and writes a new text with update, stamped like a save', async () => {
    const written: unknown[] = []
    const firebase = {
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: () => Promise.resolve({ exists: true, data: () => ({ set, guidelines: 'old' }) }),
            update: (data: unknown) => {
              written.push(data)
              return Promise.resolve()
            },
            set: () => Promise.reject(new Error('never a full write')),
            onSnapshot: () => () => undefined,
          }),
        }),
      }),
      storage: () => ({ ref: () => ({ getDownloadURL: () => Promise.reject(new Error('none')) }) }),
      auth: () => ({ currentUser: { email: 'hofi@example.com', getIdToken: () => Promise.resolve('t') } }),
    } as unknown as CompatFirebase
    const store = firestoreProjectStore({ setId: 'default', firebase })
    await store.load()
    expect(store.guidelines!()).toBe('old')
    await store.saveGuidelines!('new')
    expect(store.guidelines!()).toBe('new')
    expect(written).toEqual([
      { guidelines: 'new', updatedAt: expect.any(String), updatedBy: 'hofi@example.com' },
    ])
  })
})
