import type { ScreenOverrides, Settings } from '../types'

export type ProjectTarget = { id: string; sizeId: string; deviceId: string; out: string }
export type ProjectLocale = { id: string; store: Record<string, string> }
export type SlotKind = 'screen' | 'artwork'
export type ProjectSlot = {
  id: string
  kind: SlotKind
  screen: string
  overrides: ScreenOverrides
  /** open feedback for whoever regenerates this screenshot; never part of the approval hash */
  note?: string
}
export type Approval = { hash: string; by: string; at: string }
export type ProjectSettings = Omit<Settings, 'sizeId' | 'deviceId'>

export type ProjectSet = {
  version: 1
  id: string
  targets: ProjectTarget[]
  locales: ProjectLocale[]
  /** template with {locale} and {screen} */
  sources: string
  settings: Partial<ProjectSettings>
  slots: ProjectSlot[]
  approval: Approval | null
}

export type SlotCopy = { headline: string; subhead: string }
export type LocaleCopy = Record<string, SlotCopy>
export type ProjectCopies = Record<string, LocaleCopy>
export type Project = { set: ProjectSet; copies: ProjectCopies }
