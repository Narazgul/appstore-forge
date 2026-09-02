import type { Project } from './types'

export interface ProjectStore {
  load(): Promise<Project>
  save(project: Project): Promise<void>
  sourceUrl(localeId: string, screen: string): string
  sourceBytes(localeId: string, screen: string): Promise<Uint8Array>
  /** fires when the project changed outside this GUI, e.g. an agent edited the files */
  subscribe?(onChange: () => void): () => void
}
