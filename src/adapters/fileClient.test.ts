import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileProjectStore, setIdFromLocation } from './fileClient'
import type { Project } from '../project/types'

describe('setIdFromLocation', () => {
  it('reads ?set= from the query string', () => {
    expect(setIdFromLocation('?set=promo')).toBe('promo')
    expect(setIdFromLocation('?foo=bar&set=promo')).toBe('promo')
  })
  it('is undefined without a ?set= param, for the server default to decide', () => {
    expect(setIdFromLocation('')).toBeUndefined()
    expect(setIdFromLocation('?foo=bar')).toBeUndefined()
  })
})

const project = (id = 'default'): Project => ({
  set: {
    version: 1,
    id,
    targets: [],
    locales: [],
    sources: 's/{locale}/{screen}.png',
    settings: {},
    slots: [],
    approval: null,
  },
  copies: {},
})

/** Node has no `location`/`import.meta.hot`; this file is a dev-server-only client, so the test
 *  stands in for the browser it actually runs in. */
describe('fileProjectStore', () => {
  const originalLocation = globalThis.location
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.stubGlobal('location', new URL('http://localhost:4324/'))
  })
  afterEach(() => {
    vi.stubGlobal('location', originalLocation)
    vi.stubGlobal('fetch', originalFetch)
  })

  it('starts with no set id when the URL carries none', () => {
    expect(fileProjectStore().currentSetId).toBeUndefined()
  })

  it('reads the set id from ?set= up front', () => {
    vi.stubGlobal('location', new URL('http://localhost:4324/?set=promo'))
    expect(fileProjectStore().currentSetId).toBe('promo')
  })

  it('load() fetches /api/project with ?set= when the URL named one', async () => {
    vi.stubGlobal('location', new URL('http://localhost:4324/?set=promo'))
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url)
        if (url.startsWith('/api/project')) {
          return Promise.resolve(new Response(JSON.stringify(project('promo')), { status: 200 }))
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    )
    const store = fileProjectStore()
    const loaded = await store.load()
    expect(loaded.set.id).toBe('promo')
    expect(calls[0]).toBe('/api/project?set=promo')
  })

  it('load() without ?set= asks the server for its default, then adopts the id it answers with', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.startsWith('/api/project')
          ? Promise.resolve(new Response(JSON.stringify(project('default')), { status: 200 }))
          : Promise.resolve(new Response('{}', { status: 200 })),
      ),
    )
    const store = fileProjectStore()
    expect(store.currentSetId).toBeUndefined()
    await store.load()
    expect(store.currentSetId).toBe('default')
  })

  it('save() PUTs to /api/project with the set id query', async () => {
    vi.stubGlobal('location', new URL('http://localhost:4324/?set=promo'))
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return Promise.resolve(new Response(null, { status: 204 }))
      }),
    )
    await fileProjectStore().save(project('promo'))
    expect(calls[0].url).toBe('/api/project?set=promo')
    expect(calls[0].init?.method).toBe('PUT')
  })

  it('listSets() reads /api/sets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(['default', 'promo']), { status: 200 }))),
    )
    await expect(fileProjectStore().listSets?.()).resolves.toEqual(['default', 'promo'])
  })

  it('createSet() posts to /api/sets and throws a clear error on 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 409 }))),
    )
    await expect(fileProjectStore().createSet?.(project('promo'))).rejects.toThrow(/already exists/)
  })

  it('createSet() succeeds on 201', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ id: 'promo' }), { status: 201 }))),
    )
    await expect(fileProjectStore().createSet?.(project('promo'))).resolves.toBeUndefined()
  })

  it('openSet() navigates to the same URL with ?set= replaced', () => {
    const loc = new URL('http://localhost:4324/?set=default')
    vi.stubGlobal('location', loc)
    fileProjectStore().openSet?.('promo')
    expect(loc.href).toBe('http://localhost:4324/?set=promo')
  })
})
