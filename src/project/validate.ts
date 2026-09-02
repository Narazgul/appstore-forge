import { DEVICES } from '../presets/devices'
import { EXPORT_SIZES } from '../presets/sizes'
import { sourcePath } from './bridge'
import type { Project } from './types'

export type Issue = { level: 'error' | 'warn'; message: string; slot?: string; locale?: string }

export function validateProject(
  project: Project,
  sourceExists: (localeId: string, screen: string) => boolean,
): Issue[] {
  const { set, copies } = project
  const issues: Issue[] = []
  const error = (message: string, where: { slot?: string; locale?: string } = {}) =>
    issues.push({ level: 'error', message, ...where })

  for (const target of set.targets) {
    if (!EXPORT_SIZES.some((s) => s.id === target.sizeId)) error(`Unknown size ${target.sizeId}`)
    if (!DEVICES.some((d) => d.id === target.deviceId)) error(`Unknown device ${target.deviceId}`)
    for (const locale of set.locales) {
      if (!locale.store[target.id]) error(`No store locale for target ${target.id}`, { locale: locale.id })
    }
  }

  const seen = new Set<string>()
  for (const slot of set.slots) {
    if (seen.has(slot.id)) error(`Duplicate slot id ${slot.id}`, { slot: slot.id })
    seen.add(slot.id)
    if (slot.kind === 'artwork') error('Slot kind artwork is not supported yet', { slot: slot.id })
  }

  for (const locale of set.locales) {
    const copy = copies[locale.id] ?? {}
    for (const slot of set.slots) {
      if (!sourceExists(locale.id, slot.screen))
        error(`Source image missing: ${sourcePath(set, locale.id, slot.screen)}`, {
          slot: slot.id,
          locale: locale.id,
        })
      if (!copy[slot.id]?.headline.trim()) error('Headline missing', { slot: slot.id, locale: locale.id })
    }
    for (const slotId of Object.keys(copy)) {
      if (!seen.has(slotId))
        issues.push({ level: 'warn', message: 'Copy for unknown slot', slot: slotId, locale: locale.id })
    }
  }
  return issues
}
