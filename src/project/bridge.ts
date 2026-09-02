import { DEFAULT_SETTINGS } from '../store'
import type { Screen, Settings } from '../types'
import type { Project, ProjectSet, ProjectTarget } from './types'

export const imageIdFor = (localeId: string, screen: string) => `${localeId}/${screen}`

export function screensFor(project: Project, localeId: string): Screen[] {
  const copy = project.copies[localeId] ?? {}
  return project.set.slots.map((slot) => ({
    id: slot.id,
    headline: copy[slot.id]?.headline ?? '',
    subhead: copy[slot.id]?.subhead ?? '',
    imageId: imageIdFor(localeId, slot.screen),
    overrides: { ...slot.overrides },
    lang: localeId,
  }))
}

export function settingsFor(project: Project, targetId: string): Settings {
  const target = project.set.targets.find((t) => t.id === targetId)
  if (!target) throw new Error(`Unknown target "${targetId}"`)
  return {
    ...DEFAULT_SETTINGS,
    ...project.set.settings,
    sizeId: target.sizeId,
    deviceId: target.deviceId,
  }
}

export const sourcePath = (set: ProjectSet, localeId: string, screen: string) =>
  set.sources.replaceAll('{locale}', localeId).replaceAll('{screen}', screen)

export const outPath = (target: ProjectTarget, storeLocale: string, n: number) =>
  target.out.replaceAll('{storeLocale}', storeLocale).replace('{n}', String(n))
