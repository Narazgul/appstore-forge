import { isSlotEffect, isSlotSticker } from './types'
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
 * The text part of the approval: set and copies as canonical JSON, without the stamp itself and
 * without what a slot carries that draws no pixel. Two projects with the same content here and the
 * same image files hash alike — which is how undo/redo (`store.ts`) tell a step the stamp never
 * covered from one that makes it stale.
 */
export function approvalContent(project: Pick<Project, 'set' | 'copies'>): string {
  const { approval: _ignored, ...set } = project.set
  // A note is a message about the set, not part of it — hashing it would make feedback stale an
  // approval. A role draws no pixel either, for the same reason it stays out too.
  const hashable = { ...set, slots: set.slots.map(({ note: _note, role: _role, ...slot }) => slot) }
  return canonicalJson({ set: hashable, copies: project.copies })
}

/**
 * Text parts first, then every referenced source image in locale × slot order, then the paired
 * screens, the artwork/sticker images, and finally the mosaic layout's extra cells — each of
 * those groups only when a slot has one, so a set using none of them keeps the exact hash it had
 * before that feature existed.
 */
export async function approvalHash(
  project: Project,
  sourceBytes: (localeId: string, screen: string) => Promise<Uint8Array>,
  artworkBytes?: (localeId: string, artwork: string) => Promise<Uint8Array>,
  nodesBytes?: (localeId: string, screen: string) => Promise<Uint8Array>,
): Promise<string> {
  const { set } = project
  const parts: Uint8Array[] = [new TextEncoder().encode(approvalContent(project))]
  for (const locale of set.locales) {
    for (const slot of set.slots) {
      if (slot.kind !== 'artwork' && slot.screen) parts.push(await sourceBytes(locale.id, slot.screen))
    }
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
    // Stickers resolve through the same artwork template. Last, and only for slots that have
    // one, so a set with none keeps the exact hash it had before this feature existed. A shape
    // has no image at all, and a chip's text already went into the set JSON above (as part of
    // `copies`) — neither loads bytes here.
    for (const locale of set.locales) {
      for (const slot of set.slots) {
        for (const el of (slot.elements ?? []).filter(isSlotSticker))
          parts.push(await artworkBytes(locale.id, el.artwork))
      }
    }
  }
  // The mosaic layout's extra cells, last of all and only for the slots that have them, so a set
  // with none keeps the exact hash it had before this feature existed.
  for (const locale of set.locales) {
    for (const slot of set.slots) {
      for (const screen of slot.extra ?? []) parts.push(await sourceBytes(locale.id, screen))
    }
  }
  // A capture's nodes file decides where a `node` effect lands, so it counts like an image — but
  // only for a slot with such an effect, so every other set keeps the hash it had before.
  if (nodesBytes) {
    for (const locale of set.locales) {
      for (const slot of set.slots) {
        const usesNodes = (slot.elements ?? []).some((el) => isSlotEffect(el) && el.node !== undefined)
        if (usesNodes && slot.kind !== 'artwork' && slot.screen)
          parts.push(await nodesBytes(locale.id, slot.screen))
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
