import type { Project } from './types'

/** Every image a backend holds for one locale, whether the set references it or not. */
export type Gallery = { screens: string[]; artwork: string[] }

export const EMPTY_GALLERY: Gallery = { screens: [], artwork: [] }

/** A background image the backend can serve, by its path from the repo root; `average` is its mean
 *  colour when the credits name one. */
export type BackgroundChoice = { src: string; average?: string }

export interface ProjectStore {
  load(): Promise<Project>
  save(project: Project): Promise<void>
  sourceUrl(localeId: string, screen: string): string
  sourceBytes(localeId: string, screen: string): Promise<Uint8Array>
  /** the slot's frameless artwork; absent means the backend serves no artwork at all */
  artworkUrl?(localeId: string, artwork: string): string
  artworkBytes?(localeId: string, artwork: string): Promise<Uint8Array>
  /** a capture's nodes file next to the screenshot, which effects aim at; rejects when absent.
   *  Absent method: the backend keeps no captures, and a `node` effect draws nothing. */
  nodesBytes?(localeId: string, screen: string): Promise<Uint8Array>
  /** a background image by its path from the repo root; absent: the backend serves none, the
   *  background's colour shows instead */
  backgroundUrl?(src: string): string
  backgroundBytes?(src: string): Promise<Uint8Array>
  /** every background image the backend offers for picking, filled by `load`; absent: no picker */
  backgroundGallery?(): BackgroundChoice[]
  /**
   * Everything the backend has for a locale, so the GUI can offer a choice per frame instead of
   * only the images a slot already names. Filled by `load`; absent means no picker.
   */
  gallery?(localeId: string): Gallery
  /** the project's design rules (guidelines.md), filled by `load`; absent: the backend keeps none */
  guidelines?(): string | null
  /** replaces the design rules; absent: they are read-only here */
  saveGuidelines?(text: string): Promise<void>
  /** fires when the project changed outside this GUI, e.g. an agent edited the files */
  subscribe?(onChange: () => void): () => void
  /** the set this store instance was opened with; absent means the backend has only ever one set */
  currentSetId?: string
  /** every set id the backend holds; absent means the GUI hides the switcher */
  listSets?(): Promise<string[]>
  /** writes a brand new set; rejects when `project.set.id` already exists — never overwrites */
  createSet?(project: Project): Promise<void>
  /** switches the whole GUI to another set, e.g. by navigating there */
  openSet?(id: string): void
}
