import type { Gallery, ProjectStore } from '../project/store'
import { EMPTY_GALLERY } from '../project/store'
import type { Project } from '../project/types'

export function fileProjectStore(): ProjectStore {
  const sourceUrl = (localeId: string, screen: string) =>
    `/sources/${encodeURIComponent(localeId)}/${encodeURIComponent(screen)}.png`
  const artworkUrl = (localeId: string, artwork: string) =>
    `/artwork/${encodeURIComponent(localeId)}/${encodeURIComponent(artwork)}.png`
  let galleries: Record<string, Gallery> = {}
  return {
    async load() {
      const res = await fetch('/api/project')
      if (!res.ok) throw new Error(`Project load failed: ${res.status}`)
      const project = (await res.json()) as Project
      // A dev server too old to serve the listing costs the picker, not the project.
      galleries = await fetch('/api/gallery')
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, Gallery>>) : {}))
        .catch(() => ({}))
      return project
    },
    async save(project) {
      const res = await fetch('/api/project', {
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
    gallery(localeId) {
      return galleries[localeId] ?? EMPTY_GALLERY
    },
    subscribe(onChange) {
      if (!import.meta.hot) return () => undefined
      import.meta.hot.on('project:changed', onChange)
      return () => import.meta.hot?.off('project:changed', onChange)
    },
  }
}
