import { DEVICES } from '../presets/devices'
import { getPosition } from '../presets/positions'
import { EXPORT_SIZES } from '../presets/sizes'
import { DEFAULT_SETTINGS } from '../store'
import { DEFAULT_ARTWORK_SOURCES, artworkPath, sourcePath } from './bridge'
import { slotScreens } from './types'
import type { Project, ProjectSet, ProjectSlot } from './types'

export type Issue = { level: 'error' | 'warn'; message: string; slot?: string; locale?: string }

/** The arrangement a slot really renders in: the set's look, then the slot's own overrides. */
const positionOf = (set: ProjectSet, slot: ProjectSlot) =>
  getPosition(slot.overrides.positionId ?? set.settings.positionId ?? DEFAULT_SETTINGS.positionId)

export function validateProject(
  project: Project,
  sourceExists: (localeId: string, screen: string) => boolean,
  artworkExists: (localeId: string, artwork: string) => boolean = () => true,
): Issue[] {
  const { set, copies } = project
  const issues: Issue[] = []
  const error = (message: string, where: { slot?: string; locale?: string } = {}) =>
    issues.push({ level: 'error', message, ...where })

  const artworkTemplate = set.artworkSources ?? DEFAULT_ARTWORK_SOURCES
  if (!artworkTemplate.includes('{artwork}')) error('artworkSources must contain {artwork}')
  const artworkPerLocale = artworkTemplate.includes('{locale}')

  for (const target of set.targets) {
    if (!EXPORT_SIZES.some((s) => s.id === target.sizeId)) error(`Unknown size ${target.sizeId}`)
    if (!DEVICES.some((d) => d.id === target.deviceId)) error(`Unknown device ${target.deviceId}`)
    for (const locale of set.locales) {
      if (!locale.store?.[target.id]) error(`No store locale for target ${target.id}`, { locale: locale.id })
    }
  }

  const seen = new Set<string>()
  for (const slot of set.slots) {
    if (seen.has(slot.id)) error(`Duplicate slot id ${slot.id}`, { slot: slot.id })
    seen.add(slot.id)
    if (slot.kind === 'artwork') error('Slot kind artwork is not supported yet', { slot: slot.id })
    const position = positionOf(set, slot)
    if (!slot.artwork && position.placements.some((p) => p.source === 'artwork'))
      error(`Arrangement ${position.id} needs an artwork, but the slot names none`, { slot: slot.id })
    if (slot.note?.trim())
      issues.push({ level: 'warn', message: `Open feedback: ${slot.note.trim()}`, slot: slot.id })
  }

  // One artwork may serve every language; reporting the same missing file 19 times helps nobody.
  const artworkReported = new Set<string>()
  for (const locale of set.locales) {
    const copy = copies[locale.id] ?? {}
    for (const slot of set.slots) {
      for (const screen of slotScreens(slot)) {
        if (!sourceExists(locale.id, screen))
          error(`Source image missing: ${sourcePath(set, locale.id, screen)}`, {
            slot: slot.id,
            locale: locale.id,
          })
      }
      if (slot.artwork) {
        const path = artworkPath(set, locale.id, slot.artwork)
        if (!artworkReported.has(path)) {
          artworkReported.add(path)
          if (!artworkExists(locale.id, slot.artwork))
            error(
              `Artwork image missing: ${path}`,
              artworkPerLocale ? { slot: slot.id, locale: locale.id } : { slot: slot.id },
            )
        }
      }
      if (!copy[slot.id]?.headline?.trim()) error('Headline missing', { slot: slot.id, locale: locale.id })
    }
    for (const slotId of Object.keys(copy)) {
      if (!seen.has(slotId))
        issues.push({ level: 'warn', message: 'Copy for unknown slot', slot: slotId, locale: locale.id })
    }
  }
  return issues
}
