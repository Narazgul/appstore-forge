import { DEFAULT_SETTINGS } from '../store'
import type { Screen, Settings } from '../types'
import type { Project, ProjectSet, ProjectTarget } from './types'

export const imageIdFor = (localeId: string, screen: string) => `${localeId}/${screen}`

/** Own prefix, so an artwork and a screen of the same name never collide in the image registry. */
export const artworkIdFor = (localeId: string, artwork: string) => `artwork/${localeId}/${artwork}`

export const DEFAULT_ARTWORK_SOURCES = 'aso/artwork/{artwork}.png'

export function screensFor(project: Project, localeId: string): Screen[] {
  const copy = project.copies[localeId] ?? {}
  return project.set.slots.map((slot) => ({
    id: slot.id,
    headline: copy[slot.id]?.headline ?? '',
    subhead: copy[slot.id]?.subhead ?? '',
    imageId: imageIdFor(localeId, slot.screen),
    artworkId: slot.artwork ? artworkIdFor(localeId, slot.artwork) : null,
    pairId: slot.pair ? imageIdFor(localeId, slot.pair) : null,
    pairPrevId: slot.pairPrev ? imageIdFor(localeId, slot.pairPrev) : null,
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

export const artworkPath = (set: ProjectSet, localeId: string, artwork: string) =>
  (set.artworkSources ?? DEFAULT_ARTWORK_SOURCES)
    .replaceAll('{locale}', localeId)
    .replaceAll('{artwork}', artwork)

export const outPath = (target: ProjectTarget, storeLocale: string, n: number) =>
  target.out.replaceAll('{storeLocale}', storeLocale).replace('{n}', String(n))
