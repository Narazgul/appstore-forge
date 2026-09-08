import type { Project } from './types'

/** Every image a backend holds for one locale, whether the set references it or not. */
export type Gallery = { screens: string[]; artwork: string[] }

export const EMPTY_GALLERY: Gallery = { screens: [], artwork: [] }

export interface ProjectStore {
  load(): Promise<Project>
  save(project: Project): Promise<void>
  sourceUrl(localeId: string, screen: string): string
  sourceBytes(localeId: string, screen: string): Promise<Uint8Array>
  /** the slot's frameless artwork; absent means the backend serves no artwork at all */
  artworkUrl?(localeId: string, artwork: string): string
  artworkBytes?(localeId: string, artwork: string): Promise<Uint8Array>
  /**
   * Everything the backend has for a locale, so the GUI can offer a choice per frame instead of
   * only the images a slot already names. Filled by `load`; absent means no picker.
   */
  gallery?(localeId: string): Gallery
  /** fires when the project changed outside this GUI, e.g. an agent edited the files */
  subscribe?(onChange: () => void): () => void
}
