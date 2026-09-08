import type { Project } from './types'

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Text parts first, then every referenced source image in locale × slot order, then the paired
 * screens and the artwork of the slots that name one. Those two come last and only when a slot
 * has them, so a set with neither keeps the exact hash it had before the feature existed.
 */
export async function approvalHash(
  project: Project,
  sourceBytes: (localeId: string, screen: string) => Promise<Uint8Array>,
  artworkBytes?: (localeId: string, artwork: string) => Promise<Uint8Array>,
): Promise<string> {
  const { approval: _ignored, ...set } = project.set
  // A note is a message about the set, not part of it — hashing it would make feedback stale an approval.
  const hashable = { ...set, slots: set.slots.map(({ note: _note, ...slot }) => slot) }
  const parts: Uint8Array[] = [
    new TextEncoder().encode(canonicalJson({ set: hashable, copies: project.copies })),
  ]
  for (const locale of set.locales) {
    for (const slot of set.slots) parts.push(await sourceBytes(locale.id, slot.screen))
  }
  for (const locale of set.locales) {
    for (const slot of set.slots) {
      for (const screen of [slot.pair, slot.pairPrev]) {
        if (screen) parts.push(await sourceBytes(locale.id, screen))
      }
    }
  }
  if (artworkBytes) {
    for (const locale of set.locales) {
      for (const slot of set.slots) {
        if (slot.artwork) parts.push(await artworkBytes(locale.id, slot.artwork))
      }
    }
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    joined.set(p, offset)
    offset += p.byteLength
  }
  return hex(await crypto.subtle.digest('SHA-256', joined))
}
