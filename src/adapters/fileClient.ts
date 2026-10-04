import type { Gallery, ProjectStore } from '../project/store'
import { EMPTY_GALLERY } from '../project/store'
import type { Project } from '../project/types'

/** The set this tab addresses: `?set=` in the URL, or undefined for the server's own default. */
export function setIdFromLocation(search: string): string | undefined {
  return new URLSearchParams(search).get('set') ?? undefined
}

export function fileProjectStore(): ProjectStore {
  const sourceUrl = (localeId: string, screen: string) =>
    `/sources/${encodeURIComponent(localeId)}/${encodeURIComponent(screen)}.png`
  const artworkUrl = (localeId: string, artwork: string) =>
    `/artwork/${encodeURIComponent(localeId)}/${encodeURIComponent(artwork)}.png`
  const backgroundUrl = (src: string) => `/backgrounds/${src.split('/').map(encodeURIComponent).join('/')}`
  let galleries: Record<string, Gallery> = {}
  // `undefined` until `load()` names the set authoritatively — the URL may carry none at all,
  // in which case the server's own `forge dev --set` default decides.
  let setId: string | undefined = setIdFromLocation(location.search)
  const projectQuery = () => (setId ? `?set=${encodeURIComponent(setId)}` : '')
  return {
    get currentSetId() {
      return setId
    },
    async load() {
      const res = await fetch(`/api/project${projectQuery()}`)
      if (!res.ok) throw new Error(`Project load failed: ${res.status}`)
      const project = (await res.json()) as Project
      setId = project.set.id
      // A dev server too old to serve the listing costs the picker, not the project.
      galleries = await fetch('/api/gallery')
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, Gallery>>) : {}))
        .catch(() => ({}))
      return project
    },
    async save(project) {
      const res = await fetch(`/api/project${projectQuery()}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(project),
      })
      if (!res.ok) throw new Error(`Project save failed: ${res.status}`)
    },
    sourceUrl,
    async sourceBytes(localeId, screen) {
      const res = await fetch(sourceUrl(localeId, screen))
      if (!res.ok) throw new Error(`Source missing: ${localeId}/${screen}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    artworkUrl,
    async artworkBytes(localeId, artwork) {
      const res = await fetch(artworkUrl(localeId, artwork))
      if (!res.ok) throw new Error(`Artwork missing: ${localeId}/${artwork}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    backgroundUrl,
    async backgroundBytes(src) {
      const res = await fetch(backgroundUrl(src))
      if (!res.ok) throw new Error(`Background missing: ${src}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    async nodesBytes(localeId, screen) {
      const res = await fetch(`/nodes/${encodeURIComponent(localeId)}/${encodeURIComponent(screen)}.json`)
      if (!res.ok) throw new Error(`Nodes missing: ${localeId}/${screen}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    gallery(localeId) {
      return galleries[localeId] ?? EMPTY_GALLERY
    },
    subscribe(onChange) {
      if (!import.meta.hot) return () => undefined
      import.meta.hot.on('project:changed', onChange)
      return () => import.meta.hot?.off('project:changed', onChange)
    },
    async listSets() {
      const res = await fetch('/api/sets')
      if (!res.ok) throw new Error(`Listing sets failed: ${res.status}`)
      return (await res.json()) as string[]
    },
    async createSet(project) {
      const res = await fetch('/api/sets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(project),
      })
      if (res.status === 409) throw new Error(`Set "${project.set.id}" already exists`)
      if (!res.ok) throw new Error(`Creating set failed: ${res.status}`)
    },
    openSet(id) {
      const url = new URL(location.href)
      url.searchParams.set('set', id)
      location.href = url.toString()
    },
  }
}
