import type { ProjectStore } from '../project/store'
import type { Project } from '../project/types'

export function fileProjectStore(): ProjectStore {
  const sourceUrl = (localeId: string, screen: string) =>
    `/sources/${encodeURIComponent(localeId)}/${encodeURIComponent(screen)}.png`
  const artworkUrl = (localeId: string, artwork: string) =>
    `/artwork/${encodeURIComponent(localeId)}/${encodeURIComponent(artwork)}.png`
  return {
    async load() {
      const res = await fetch('/api/project')
      if (!res.ok) throw new Error(`Project load failed: ${res.status}`)
      return (await res.json()) as Project
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
    subscribe(onChange) {
      if (!import.meta.hot) return () => undefined
      import.meta.hot.on('project:changed', onChange)
      return () => import.meta.hot?.off('project:changed', onChange)
    },
  }
}
