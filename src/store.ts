import { create } from 'zustand'
import { changedElementFields } from './lib/canvasEdit'
import type { CanvasEdit, CanvasOverrides } from './lib/canvasEdit'
import { preloadScriptFonts } from './presets/fonts'
import { getRhythm, rhythmStep } from './presets/rhythms'
import { getTemplateSpec } from './presets/templates'
import {
  artworkIdFor,
  backgroundIdFor,
  imageIdFor,
  screensFor,
  settingsFor,
  type NodesLookup,
} from './project/bridge'
import { approvalContent, approvalHash } from './project/hash'
import { EMPTY_GALLERY } from './project/store'
import type { Gallery, ProjectStore } from './project/store'
import { backgroundImageSrcs, hasChipText, isSlotPlaced, isSlotSticker, usesNodes } from './project/types'
import type {
  Approval,
  NodesFile,
  Project,
  ProjectCopies,
  ProjectSettings,
  ProjectTarget,
  SlotCopy,
  SlotElement,
  TileRole,
} from './project/types'
import type { OptionalSettingKey, Screen, ScreenOverrides, Settings, TemplateSpec } from './types'

/** The guided flow. Steps are navigation and status, never a gate — any step is one click away. */
export type StepId = 'target' | 'look' | 'shots' | 'review'
export const STEPS: StepId[] = ['target', 'look', 'shots', 'review']

/** Cosmetic store-page details for the preview; nothing here reaches the exported pixels. */
export type Listing = { name: string; subtitle: string; developer: string; category: string }

let seq = 0
const nextId = () => `s${++seq}`

export const DEFAULT_SETTINGS: Settings = {
  background: { kind: 'solid', color: '#eaf2ff' },
  backdropColor: null,
  deviceId: 'iphone-17-pro',
  frameColorId: 'deep-blue',
  deviceShadow: 'soft',
  positionId: 'center',
  layout: 'text-top',
  tilt: 0,
  deviceScale: 1,
  textColor: '#111114',
  eyebrowColor: null,
  textAlign: 'center',
  highlights: ['#ffe27a'],
  fontId: 'inter',
  headlineScale: 1,
  subheadScale: 1,
  headlineTracking: -0.01,
  accentBar: null,
  subheadStyle: 'plain',
  sizeId: 'iphone-6-9',
  altColors: null,
  inverted: false,
}

/** The overrides a template pins on the screen at `index`; empty for templates without variants. */
export const variantFor = (template: TemplateSpec, index: number): ScreenOverrides =>
  template.variants?.length ? { ...template.variants[index % template.variants.length] } : {}

/** A set template has a fixed number of screens — one per variant. 0 means freeform. */
export const slotCount = (template: TemplateSpec): number => template.variants?.length ?? 0

/** An unfilled slot carries the template's sample copy until a screenshot lands in it. */
const emptySlot = (template: TemplateSpec, index: number): Screen => ({
  id: nextId(),
  headline: template.samples[index % template.samples.length]?.headline ?? '',
  subhead: template.samples[index % template.samples.length]?.subhead ?? '',
  imageId: null,
  overrides: variantFor(template, index),
})

/** A template is a reset: everything goes back to defaults, then the template's look is laid on
 *  top. Export size and device are the user's choice and survive. */
export const templateSettings = (template: TemplateSpec, current: Settings): Settings => ({
  ...DEFAULT_SETTINGS,
  ...template.settings,
  sizeId: current.sizeId,
  deviceId: current.deviceId,
})

export function projectAfterScreenPatch(
  project: Project,
  localeId: string,
  screenId: string,
  patch: Partial<SlotCopy>,
): Project {
  const locale = project.copies[localeId] ?? {}
  const current = locale[screenId] ?? { headline: '', subhead: '' }
  const merged: SlotCopy = { ...current, ...patch }
  // An empty eyebrow is the same as none; keeping the key would persist a no-op edit and
  // change the approval hash for a project that never had the field.
  if (!merged.eyebrow) delete merged.eyebrow
  if (!merged.list?.length) delete merged.list
  return {
    set: { ...project.set, approval: null },
    copies: { ...project.copies, [localeId]: { ...locale, [screenId]: merged } },
  }
}

/**
 * Merges one chip's text into a slot's copy, leaving every other chip's text (and the headline,
 * subhead, eyebrow) untouched — `setCopy`'s `chips` patch would otherwise be a full replacement
 * and lose the rest of the map.
 */
export function projectAfterChipPatch(
  project: Project,
  localeId: string,
  screenId: string,
  chipId: string,
  text: string,
): Project {
  const locale = project.copies[localeId] ?? {}
  const current = locale[screenId] ?? { headline: '', subhead: '' }
  const merged: SlotCopy = { ...current, chips: { ...current.chips, [chipId]: text } }
  return {
    set: { ...project.set, approval: null },
    copies: { ...project.copies, [localeId]: { ...locale, [screenId]: merged } },
  }
}

export function projectAfterOverride(project: Project, slotId: string, overrides: ScreenOverrides): Project {
  return {
    set: {
      ...project.set,
      approval: null,
      slots: project.set.slots.map((s) => (s.id === slotId ? { ...s, overrides } : s)),
    },
    copies: project.copies,
  }
}

/**
 * The overrides after a canvas gesture: a field present with a value is written, one present as
 * `undefined` is dropped (the tile inherits again, see `resolveOverrides`). Null when nothing
 * changes — a click, or a drag that came back to where it started, must not become an undo step
 * or a save.
 */
export function overridesAfterCanvasEdit(
  overrides: ScreenOverrides,
  fields: CanvasOverrides,
): ScreenOverrides | null {
  const next: ScreenOverrides = { ...overrides }
  for (const key of Object.keys(fields) as (keyof CanvasOverrides)[]) {
    const value = fields[key]
    if (value === undefined) delete next[key]
    else (next as Record<string, unknown>)[key] = value
  }
  return JSON.stringify(next) === JSON.stringify(overrides) ? null : next
}

/** One finished canvas gesture applied to a project slot — its overrides or one of its elements.
 *  Null when the gesture changed nothing. */
export function projectAfterCanvasEdit(project: Project, slotId: string, edit: CanvasEdit): Project | null {
  const slot = project.set.slots.find((s) => s.id === slotId)
  if (!slot) return null
  if (edit.kind === 'settings') {
    const overrides = overridesAfterCanvasEdit(slot.overrides, edit.fields)
    return overrides ? projectAfterOverride(project, slotId, overrides) : null
  }
  const elements = slot.elements ?? []
  const current = elements.filter(isSlotPlaced).find((el) => el.id === edit.id)
  if (!current) return null
  const changed = changedElementFields(current, edit.fields)
  if (!changed) return null
  const next = { ...current } as Record<string, unknown>
  for (const [key, value] of Object.entries(changed)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return projectAfterSlotElements(
    project,
    slotId,
    elements.map((el) => (el.id === edit.id ? (next as SlotElement) : el)),
  )
}

/** A template in project mode is a look, not a set: it never adds or drops slots. */
export function projectAfterTemplate(project: Project, template: TemplateSpec): Project {
  const { sizeId: _size, deviceId: _device, ...base } = DEFAULT_SETTINGS
  return {
    set: {
      ...project.set,
      approval: null,
      settings: { ...base, ...template.settings },
      slots: project.set.slots.map((slot, i) => ({ ...slot, overrides: variantFor(template, i) })),
    },
    copies: project.copies,
  }
}

/** The set-wide look: `patch` is written, every key in `clear` dropped so it falls back to the
 *  default again (`OptionalSettingKey`s simply disappear). */
export function projectAfterSettings(
  project: Project,
  patch: Partial<ProjectSettings>,
  clear: (keyof ProjectSettings)[] = [],
): Project {
  const settings = { ...project.set.settings, ...patch }
  for (const key of clear) delete settings[key]
  return { set: { ...project.set, approval: null, settings }, copies: project.copies }
}

export function projectAfterTargetPatch(
  project: Project,
  id: string,
  patch: Partial<Pick<ProjectTarget, 'sizeId' | 'deviceId'>>,
): Project {
  return {
    set: {
      ...project.set,
      approval: null,
      targets: project.set.targets.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    },
    copies: project.copies,
  }
}

/**
 * A note is feedback for the agent that regenerates a screenshot, not part of the set: it stays out
 * of the approval hash, so writing one must not go through `mutated` and drop the stamp.
 */
export function projectAfterNote(project: Project, slotId: string, note: string): Project {
  return {
    set: {
      ...project.set,
      slots: project.set.slots.map((slot) => {
        if (slot.id !== slotId) return slot
        const { note: _dropped, ...rest } = slot
        return note.trim() ? { ...rest, note } : rest
      }),
    },
    copies: project.copies,
  }
}

/**
 * A slot's place in the deck. Unlike a note, this is ordinary document content — just content that
 * draws no pixel, so it must stay out of the approval hash (`project/hash.ts`) the same way a note
 * does, while still being an edit that travels through undo/redo like any other.
 */
export function projectAfterRole(project: Project, slotId: string, role: TileRole | undefined): Project {
  return {
    set: {
      ...project.set,
      slots: project.set.slots.map((slot) => {
        if (slot.id !== slotId) return slot
        const { role: _dropped, ...rest } = slot
        return role ? { ...rest, role } : rest
      }),
    },
    copies: project.copies,
  }
}

/** Which frame of a slot an image goes into; `screen` is the slot's own, the rest are optional. */
export type SlotRole = 'screen' | 'pair' | 'pairPrev' | 'artwork'

/**
 * Puts one image into one frame of a slot. Only `screen` is mandatory — clearing any other role
 * drops the field, which hands that frame back to the neighbouring slot (or, for `artwork`,
 * leaves the arrangement without one, which validation then reports).
 */
export function projectAfterSlotSource(
  project: Project,
  slotId: string,
  role: SlotRole,
  name: string | null,
): Project {
  return {
    set: {
      ...project.set,
      approval: null,
      slots: project.set.slots.map((slot) => {
        if (slot.id !== slotId) return slot
        if (role === 'screen') return name ? { ...slot, screen: name } : slot
        const { [role]: _dropped, ...rest } = slot
        return name ? { ...rest, [role]: name } : rest
      }),
    },
    copies: project.copies,
  }
}

/**
 * Writes a slot's sticker list. An empty list drops the key entirely — the GUI must never
 * persist `elements: []`, or a project that never had a sticker would hash differently forever.
 * A chip removed from the list takes its copy with it, in every locale, in this same step — one
 * write, one undo entry restoring both the element and its text together. Left behind, that copy
 * would sit under a "Copy for unknown chip" warning forever, count in the approval hash, and hand
 * itself to the next chip that happens to land on the freed id (`freeElementId` in
 * `StickersSection.tsx` reuses `chip` once nothing still claims it).
 */
export function projectAfterSlotElements(project: Project, slotId: string, elements: SlotElement[]): Project {
  const keptChipIds = new Set(elements.filter(hasChipText).map((el) => el.id))
  const copies: ProjectCopies = {}
  for (const [localeId, locale] of Object.entries(project.copies)) {
    const chips = locale[slotId]?.chips
    const chipIds = chips ? Object.keys(chips) : []
    if (!chips || chipIds.every((id) => keptChipIds.has(id))) {
      copies[localeId] = locale
      continue
    }
    const keptChips = Object.fromEntries(
      chipIds.filter((id) => keptChipIds.has(id)).map((id) => [id, chips[id]]),
    )
    const merged: SlotCopy = { ...locale[slotId]!, chips: keptChips }
    if (!Object.keys(keptChips).length) delete merged.chips
    copies[localeId] = { ...locale, [slotId]: merged }
  }
  return {
    set: {
      ...project.set,
      approval: null,
      slots: project.set.slots.map((slot) => {
        if (slot.id !== slotId) return slot
        if (!elements.length) {
          const { elements: _dropped, ...rest } = slot
          return rest
        }
        return { ...slot, elements }
      }),
    },
    copies,
  }
}

/**
 * Writes a slot's mosaic extra-screen list, same convention as `projectAfterSlotElements`: an
 * empty list drops the key entirely, so a set that never used the mosaic layout keeps its exact
 * approval hash.
 */
export function projectAfterSlotExtra(project: Project, slotId: string, extra: string[]): Project {
  return {
    set: {
      ...project.set,
      approval: null,
      slots: project.set.slots.map((slot) => {
        if (slot.id !== slotId) return slot
        if (!extra.length) {
          const { extra: _dropped, ...rest } = slot
          return rest
        }
        return { ...slot, extra }
      }),
    },
    copies: project.copies,
  }
}

/**
 * A slot id has to survive as a file-safe key and stay unique in the set; the screen name is
 * the obvious starting point, and a number is appended when a slot already carries it.
 */
export function freeSlotId(taken: string[], base: string): string {
  const clean = base.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'slot'
  if (!taken.includes(clean)) return clean
  for (let n = 2; ; n++) if (!taken.includes(`${clean}-${n}`)) return `${clean}-${n}`
}

/** Appends a tile. It starts without copy, which validation reports until someone writes one. */
export function projectAfterSlotAdd(project: Project, id: string, screen: string): Project {
  return {
    set: {
      ...project.set,
      approval: null,
      slots: [...project.set.slots, { id, kind: 'screen', screen, overrides: {} }],
    },
    copies: project.copies,
  }
}

/** Appends a tile with no source screen: copy, stickers, shapes and chips alone, or an arrangement's
 *  artwork. */
export function projectAfterArtworkSlotAdd(project: Project, id: string): Project {
  return {
    set: {
      ...project.set,
      approval: null,
      slots: [...project.set.slots, { id, kind: 'artwork', overrides: {} }],
    },
    copies: project.copies,
  }
}

/** Removing a slot removes its copy too — an orphaned entry would still feed the approval hash. */
export function projectAfterSlotRemoval(project: Project, slotId: string): Project {
  const copies: ProjectCopies = {}
  for (const [localeId, entries] of Object.entries(project.copies)) {
    const { [slotId]: _dropped, ...rest } = entries
    copies[localeId] = rest
  }
  return {
    set: {
      ...project.set,
      approval: null,
      slots: project.set.slots.filter((s) => s.id !== slotId),
    },
    copies,
  }
}

type State = {
  screens: Screen[]
  images: Record<string, HTMLImageElement>
  /** capture nodes keyed like `images`, for effects that aim at a `node` */
  nodes: Record<string, NodesFile>
  settings: Settings
  /** last template applied; new screens pick up its variant cycle */
  templateId: string
  /** the strip's rhythm: 'uniform', a built-in id, or 'template' when the template's own variants set it */
  rhythmId: string
  /** pin each screen's layout/arrangement/alignment to the rhythm's step for its index */
  applyRhythm: (id: string) => void
  step: StepId
  setStep: (step: StepId) => void
  listing: Listing
  setListing: (patch: Partial<Listing>) => void
  format: 'png' | 'jpeg'
  applyTemplate: (id: string) => void
  /** fills empty slots in order, then appends */
  addFiles: (files: File[]) => Promise<void>
  /** put one screenshot into a specific screen, replacing what was there */
  setImage: (id: string, file: File) => Promise<void>
  /** empty a slot without removing it */
  clearImage: (id: string) => void
  updateScreen: (id: string, patch: Partial<Screen>) => void
  removeScreen: (id: string) => void
  moveScreen: (id: string, delta: number) => void
  setSettings: (patch: Partial<Settings>) => void
  setFormat: (format: 'png' | 'jpeg') => void
  selectedId: string | null
  selectScreen: (id: string | null) => void
  setOverride: (id: string, patch: ScreenOverrides) => void
  clearOverrides: (id: string, keys: (keyof ScreenOverrides)[]) => void
  /** drop set-wide values that have no default (`deviceOffset`, `textOffset`) — the global scope's
   *  counterpart of `clearOverrides` */
  clearSettings: (keys: OptionalSettingKey[]) => void
  /**
   * One finished canvas gesture (a drag, a corner pull, a turn) as exactly one undo step and one
   * scheduled save. `historyKind` is unique per gesture so two quick drags never merge; arrow-key
   * nudges pass a stable one so a held key coalesces like a slider. A no-op edit writes nothing.
   */
  applyCanvasEdit: (slotId: string, edit: CanvasEdit, historyKind: string) => void
  clearAllOverrides: () => void
  reset: () => void
  /** null in freeform mode: no project on disk, everything lives in this store */
  project: Project | null
  projectStore: ProjectStore | null
  /** every image the backend holds, per locale — what the per-frame picker offers */
  gallery: Record<string, Gallery>
  localeId: string
  targetId: string
  /** null = nothing to judge, false = edited since the last approval */
  approvalOk: boolean | null
  /** the stamp an edit invalidated, so the GUI can name who approved what is now outdated */
  staleApproval: Approval | null
  /** the last failure a user action produced, shown where that action lives */
  lastError: string | null
  setLastError: (message: string | null) => void
  openProject: (store: ProjectStore) => Promise<void>
  /** re-read the project after an outside change, keeping where the user is */
  reloadProject: () => Promise<void>
  setLocale: (id: string) => void
  setTarget: (id: string) => void
  setCopy: (localeId: string, slotId: string, patch: Partial<SlotCopy>) => void
  /** one chip's text, for one locale — merges into `copies[localeId][slotId].chips` */
  setChipText: (localeId: string, slotId: string, chipId: string, text: string) => void
  /** feedback for the agent; it is not part of the set, so the approval survives it */
  setSlotNote: (slotId: string, note: string) => void
  /** this slot's place in the deck; undefined clears it. Draws no pixel, so the approval survives
   *  it too, but unlike a note it is an ordinary edit and goes through undo/redo. */
  setSlotRole: (slotId: string, role: TileRole | undefined) => void
  /** put a gallery image into one frame of a slot; null clears an optional one */
  setSlotSource: (slotId: string, role: SlotRole, name: string | null) => Promise<void>
  /** a background image by its path from the repo root, loaded into the registry once; null when
   *  the backend serves none or the file does not load */
  loadBackgroundImage: (src: string) => Promise<HTMLImageElement | null>
  /** replace a slot's sticker list; an empty list removes the key */
  setSlotElements: (slotId: string, elements: SlotElement[]) => Promise<void>
  /** replace a slot's mosaic extra-screen list; an empty list removes the key */
  setSlotExtra: (slotId: string, extra: string[]) => Promise<void>
  /** append a tile, filled with the first gallery image the active language has */
  addSlot: () => Promise<void>
  updateTarget: (id: string, patch: Partial<Pick<ProjectTarget, 'sizeId' | 'deviceId'>>) => void
  approve: (by: string) => Promise<void>
  refreshApproval: () => Promise<void>
  /** oldest first; capped at `HISTORY_LIMIT` */
  undoStack: HistorySnapshot[]
  redoStack: HistorySnapshot[]
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

/** `img.decode()` never settles in a background tab, which hung the whole GUI on a reload
 *  while the window was not focused. The load events fire either way. */
function loadImageUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Image failed to load: ${url}`))
    img.src = url
  })
}

const loadImage = (file: File): Promise<HTMLImageElement> => loadImageUrl(URL.createObjectURL(file))

/**
 * A screenshot the project names but the repo does not have yet is normal — Roborazzi has
 * not run, or a capture was renamed. Its key stays absent, `renderScene` draws the tile
 * without a source, and the rest of the grid opens.
 */
async function loadProjectImages(
  project: Project,
  store: ProjectStore,
): Promise<Record<string, HTMLImageElement>> {
  const artworkUrl = store.artworkUrl?.bind(store)
  const keys = project.set.locales.flatMap((l) =>
    project.set.slots.flatMap((s) => {
      const rows = s.screen ? [{ id: imageIdFor(l.id, s.screen), url: store.sourceUrl(l.id, s.screen) }] : []
      for (const screen of [s.pair, s.pairPrev, ...(s.extra ?? [])]) {
        if (screen) rows.push({ id: imageIdFor(l.id, screen), url: store.sourceUrl(l.id, screen) })
      }
      if (s.artwork && artworkUrl)
        rows.push({ id: artworkIdFor(l.id, s.artwork), url: artworkUrl(l.id, s.artwork) })
      // Stickers resolve through the same artwork registry as a slot's own artwork. A shape has
      // no image to load.
      if (artworkUrl) {
        for (const el of (s.elements ?? []).filter(isSlotSticker))
          rows.push({ id: artworkIdFor(l.id, el.artwork), url: artworkUrl(l.id, el.artwork) })
      }
      return rows
    }),
  )
  const backgroundUrl = store.backgroundUrl?.bind(store)
  if (backgroundUrl)
    for (const src of backgroundImageSrcs(project.set))
      keys.push({ id: backgroundIdFor(src), url: backgroundUrl(src) })
  const results = await Promise.allSettled(keys.map(({ url }) => loadImageUrl(url)))
  const images: Record<string, HTMLImageElement> = {}
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') images[keys[i].id] = result.value
    else console.warn(`source screenshot missing for ${keys[i].id}`, result.reason)
  })
  return images
}

/** The capture nodes of every slot whose effects aim at a `node`, keyed like its screenshot. A
 *  missing or broken file stays absent; the effect then draws nothing and `forge check` says why. */
async function loadProjectNodes(project: Project, store: ProjectStore): Promise<Record<string, NodesFile>> {
  const nodesBytes = store.nodesBytes?.bind(store)
  if (!nodesBytes) return {}
  const rows = project.set.locales.flatMap((l) =>
    project.set.slots
      .filter((s) => s.screen && (s.elements ?? []).some(usesNodes))
      .map((s) => ({ id: imageIdFor(l.id, s.screen!), localeId: l.id, screen: s.screen! })),
  )
  const results = await Promise.allSettled(
    rows.map(
      async (r) => JSON.parse(new TextDecoder().decode(await nodesBytes(r.localeId, r.screen))) as NodesFile,
    ),
  )
  const nodes: Record<string, NodesFile> = {}
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') nodes[rows[i].id] = result.value
  })
  return nodes
}

export const nodesLookupOf =
  (nodes: Record<string, NodesFile>): NodesLookup =>
  (localeId, screen) =>
    nodes[imageIdFor(localeId, screen)] ?? null

/** A backend without the nodes file answers with no bytes, exactly as the CLI does. */
const nodesBytesOf = (store: ProjectStore) =>
  store.nodesBytes
    ? (localeId: string, screen: string) => store.nodesBytes!(localeId, screen).catch(() => new Uint8Array())
    : undefined

/**
 * Loads images the set newly points at into the registry, for EVERY language: the set is shared,
 * so a picture that only reached the active locale would leave a hole on the next switch.
 */
async function loadNewSources(
  project: Project,
  store: ProjectStore,
  have: Record<string, HTMLImageElement>,
  name: string,
  role: SlotRole,
): Promise<Record<string, HTMLImageElement>> {
  const idFor = (localeId: string) =>
    role === 'artwork' ? artworkIdFor(localeId, name) : imageIdFor(localeId, name)
  const urlFor = (localeId: string) =>
    role === 'artwork' ? store.artworkUrl?.(localeId, name) : store.sourceUrl(localeId, name)
  const pending = project.set.locales.filter((l) => !have[idFor(l.id)])
  if (!pending.length) return {}
  const loaded = await Promise.allSettled(
    pending.map((l) => {
      const url = urlFor(l.id)
      return url ? loadImageUrl(url) : Promise.reject(new Error(`No URL for ${l.id}/${name}`))
    }),
  )
  const images: Record<string, HTMLImageElement> = {}
  loaded.forEach((result, i) => {
    if (result.status === 'fulfilled') images[idFor(pending[i].id)] = result.value
    else console.warn(`source screenshot missing for ${idFor(pending[i].id)}`, result.reason)
  })
  return images
}

/** The picker's offer per locale; an adapter without a gallery leaves every list empty. */
function readGalleries(project: Project, store: ProjectStore): Record<string, Gallery> {
  const galleries: Record<string, Gallery> = {}
  for (const locale of project.set.locales) galleries[locale.id] = store.gallery?.(locale.id) ?? EMPTY_GALLERY
  return galleries
}

/**
 * What every project mutation writes: the new project, the approval gone, and the stamp it
 * invalidated kept so the Review step can say whose approval went stale.
 */
export function mutated(state: State, project: Project, extra: Partial<State> = {}): Partial<State> {
  return {
    project,
    approvalOk: false,
    staleApproval: project.set.approval ? null : (state.project?.set.approval ?? state.staleApproval),
    ...extra,
  }
}

/**
 * The undo/redo document, one per mode. Project mode holds the persisted `{ set, copies }`, never
 * the approval stamp's meaning beyond what undo/redo overwrite it with; freeform holds `screens`
 * (ids, copy, overrides, imageId references) and `settings` — never the decoded `images` map.
 */
export type HistorySnapshot =
  | { mode: 'project'; set: Project['set']; copies: Project['copies'] }
  | { mode: 'freeform'; screens: Screen[]; settings: Settings }

export const HISTORY_LIMIT = 50
/** Consecutive edits sharing a coalescing key inside this window become one undo step. */
export const COALESCE_MS = 600

/** The key of the last recorded edit and when it landed, so a rapid follow-up (a slider drag,
 *  typing) can merge into the same step instead of filling the stack with one entry per tick. */
let lastEditKind: string | null = null
let lastEditAt = 0

const sortedKeys = (patch: object): string => Object.keys(patch).sort().join(',')

function snapshotOf(state: State): HistorySnapshot {
  return state.project
    ? { mode: 'project', set: state.project.set, copies: state.project.copies }
    : { mode: 'freeform', screens: state.screens, settings: state.settings }
}

type HistoryFields = Pick<State, 'undoStack' | 'redoStack' | 'canUndo' | 'canRedo'>

/**
 * Records the state BEFORE a user edit, keyed by "what kind of edit and on what" (a settings key,
 * an override target, a copy field) so a burst of same-kind edits inside `COALESCE_MS` collapses
 * into the one step that preceded the burst. Any edit — coalesced or not — clears the redo stack:
 * a new edit invalidates whatever could have been redone.
 */
function pushHistory(state: State, kind: string): HistoryFields {
  const now = Date.now()
  const coalesced = kind === lastEditKind && now - lastEditAt < COALESCE_MS
  lastEditKind = kind
  lastEditAt = now
  if (coalesced) {
    return {
      undoStack: state.undoStack,
      redoStack: state.redoStack,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    }
  }
  const undoStack = [...state.undoStack, snapshotOf(state)].slice(-HISTORY_LIMIT)
  return { undoStack, redoStack: [], canUndo: true, canRedo: false }
}

/** Wipes both stacks and the coalescing window — the document was replaced wholesale (a project
 *  opened, an outside change), so old snapshots would restore over material that was never edited. */
function clearHistory(): HistoryFields {
  lastEditKind = null
  lastEditAt = 0
  return { undoStack: [], redoStack: [], canUndo: false, canRedo: false }
}

/**
 * Undo/redo apply a snapshot through the same write path an edit uses: in project mode that means
 * `mutated()` (so the save is scheduled and derived `screens`/`settings` are recomputed) with the
 * approval nulled — undo is an edit, and a snapshot must never resurrect a stamp for content the
 * user is actively changing. A step that differs only in what the stamp never covered (a `role`,
 * see `approvalContent`) keeps the current stamp and its verdict instead, exactly as the edit it
 * reverses or repeats did; a stamp that is already gone stays gone either way.
 */
function applySnapshot(state: State, snapshot: HistorySnapshot): Partial<State> {
  if (snapshot.mode === 'freeform') return { screens: snapshot.screens, settings: snapshot.settings }
  if (!state.project) return {}
  const derived = (project: Project): Partial<State> => ({
    screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
    settings: project.set.targets.some((t) => t.id === state.targetId)
      ? settingsFor(project, state.targetId)
      : state.settings,
  })
  if (approvalContent(snapshot) === approvalContent(state.project)) {
    const project: Project = {
      set: { ...snapshot.set, approval: state.project.set.approval },
      copies: snapshot.copies,
    }
    return { project, ...derived(project) }
  }
  const project: Project = { set: { ...snapshot.set, approval: null }, copies: snapshot.copies }
  return mutated(state, project, derived(project))
}

let unsubscribe: (() => void) | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** True from the first edit until a save came back. Guards the reload and the tab close. */
let unsaved = false

export const hasUnsavedWork = () => unsaved

/**
 * Every edit lands here. A failed save used to be an unhandled rejection in the console: the
 * editor looked exactly like a saved one, and the work was gone on the next reload.
 */
function scheduleSave(get: () => State) {
  unsaved = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { project, projectStore, setLastError } = get()
    if (!project || !projectStore) return
    projectStore.save(project).then(
      () => {
        unsaved = false
        if (get().lastError?.startsWith(SAVE_FAILED)) setLastError(null)
      },
      (error: unknown) => {
        setLastError(`${SAVE_FAILED} ${describeError(error)}`)
      },
    )
  }, 300)
}

/**
 * A Firestore rejection carries the useful half in `code`: permission-denied, not-found and
 * invalid-argument point at three completely different causes and the message alone hides which.
 */
export function describeError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  return code ? `${message} (${code})` : message
}

/** Prefix, so a later success can clear exactly this message and not someone else's. */
export const SAVE_FAILED = 'Not saved:'

/** Shown when someone else wrote the set while this editor still holds unsaved work. */
export const OUTSIDE_CHANGE =
  'The set was changed elsewhere, but your edits are not saved yet. Do not reload — copy your work out first.'

export const useStore = create<State>((set, get) => ({
  screens: [],
  images: {},
  nodes: {},
  settings: DEFAULT_SETTINGS,
  templateId: 'classic',
  rhythmId: 'uniform',
  step: 'target',
  setStep: (step) => set({ step }),
  listing: { name: '', subtitle: '', developer: '', category: '' },
  setListing: (patch) => set((state) => ({ listing: { ...state.listing, ...patch } })),
  format: 'png',

  applyRhythm: (id) => {
    const state = get()
    const rhythm = getRhythm(id)
    const screens = state.screens.map((s, i) => {
      // Only the composition keys move; a Notebook screen keeps its colours.
      const { layout: _l, positionId: _p, textAlign: _t, ...rest } = s.overrides
      const step = rhythmStep(rhythm, i)
      return { ...s, overrides: step ? { ...rest, ...step } : rest }
    })
    if (!state.project) return set({ rhythmId: rhythm.id, screens, ...pushHistory(state, 'rhythm') })
    const project: Project = {
      set: {
        ...state.project.set,
        approval: null,
        slots: state.project.set.slots.map((slot, i) => ({
          ...slot,
          overrides: screens[i]?.overrides ?? slot.overrides,
        })),
      },
      copies: state.project.copies,
    }
    set({
      ...mutated(state, project, {
        rhythmId: rhythm.id,
        screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
      }),
      ...pushHistory(state, 'rhythm'),
    })
    scheduleSave(get)
  },

  applyTemplate: (id) => {
    const state = get()
    const template = getTemplateSpec(id)
    const rhythmId = template.rhythm ?? (template.variants?.length ? 'template' : 'uniform')
    if (state.project) {
      const project = projectAfterTemplate(state.project, template)
      set({
        ...mutated(state, project, {
          templateId: template.id,
          rhythmId,
          screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
          settings: settingsFor(project, state.targetId),
        }),
        ...pushHistory(state, 'template'),
      })
      scheduleSave(get)
      return
    }
    const slots = slotCount(template)
    // A set template lays out every slot up front so the whole look is visible before any
    // screenshot exists. Screens that already hold an image keep it (and their copy); unfilled
    // slots take the new template's sample copy; a freeform template drops empty slots.
    const filled = state.screens.filter((s) => s.imageId !== null)
    const count = Math.max(slots, filled.length)
    const screens: Screen[] = []
    for (let i = 0; i < count; i++) {
      const existing = filled[i]
      screens.push(existing ? { ...existing, overrides: variantFor(template, i) } : emptySlot(template, i))
    }
    set({
      templateId: template.id,
      rhythmId,
      settings: templateSettings(template, state.settings),
      screens,
      selectedId: screens.some((s) => s.id === state.selectedId) ? state.selectedId : null,
      ...pushHistory(state, 'template'),
    })
  },

  addFiles: async (files) => {
    // In project mode the screenshots come from the project's sources, not from a drop.
    if (get().project) return
    const usable = files.filter((f) => f.type.startsWith('image/'))
    if (!usable.length) return
    const loaded = await Promise.all(usable.map(async (file) => ({ file, img: await loadImage(file) })))
    // Read before the state updater runs, not inside it — the updater may run again with a
    // different `state` and must stay pure (rules.md 6).
    const history = pushHistory(get(), 'addFiles')
    set((state) => {
      const images = { ...state.images }
      const screens = [...state.screens]
      const template = getTemplateSpec(state.templateId)
      let slot = screens.findIndex((s) => s.imageId === null)
      for (const { file, img } of loaded) {
        const id = nextId()
        images[id] = img
        if (slot >= 0) {
          // Fill the next empty slot; the slot keeps its sample copy so the look stays intact.
          screens[slot] = { ...screens[slot], imageId: id }
          slot = screens.findIndex((s, i) => i > slot && s.imageId === null)
        } else {
          // Continue the template's variant cycle and the rhythm so a later drop matches.
          const step = rhythmStep(getRhythm(state.rhythmId), screens.length)
          screens.push({
            id,
            headline: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
            subhead: '',
            imageId: id,
            overrides: { ...variantFor(template, screens.length), ...(step ?? {}) },
          })
        }
      }
      return { images, screens, ...history }
    })
  },

  setImage: async (id, file) => {
    if (get().project) return
    if (!file.type.startsWith('image/')) return
    const img = await loadImage(file)
    const history = pushHistory(get(), `image:${id}`)
    set((state) => {
      const imageId = nextId()
      return {
        images: { ...state.images, [imageId]: img },
        screens: state.screens.map((s) => (s.id === id ? { ...s, imageId } : s)),
        ...history,
      }
    })
  },

  clearImage: (id) => {
    const state = get()
    if (state.project) return
    set({
      screens: state.screens.map((s) => (s.id === id ? { ...s, imageId: null } : s)),
      ...pushHistory(state, `clear:${id}`),
    })
  },

  updateScreen: (id, patch) => {
    const state = get()
    const screens = state.screens.map((s) => (s.id === id ? { ...s, ...patch } : s))
    const copy: Partial<SlotCopy> = {}
    if (patch.headline !== undefined) copy.headline = patch.headline
    if (patch.subhead !== undefined) copy.subhead = patch.subhead
    if (patch.eyebrow !== undefined) copy.eyebrow = patch.eyebrow
    if (patch.list !== undefined) copy.list = patch.list
    if (!state.project || Object.keys(copy).length === 0) {
      return set({ screens, ...pushHistory(state, `screen:${id}:${sortedKeys(patch)}`) })
    }
    const project = projectAfterScreenPatch(state.project, state.localeId, id, copy)
    set({
      ...mutated(state, project, { screens }),
      ...pushHistory(state, `copy:${state.localeId}:${id}:${sortedKeys(copy)}`),
    })
    scheduleSave(get)
  },

  removeScreen: (id) => {
    const state = get()
    const screens = state.screens.filter((s) => s.id !== id)
    const selectedId = state.selectedId === id ? null : state.selectedId
    if (!state.project) return set({ screens, selectedId, ...pushHistory(state, `removeScreen:${id}`) })
    const project = projectAfterSlotRemoval(state.project, id)
    set({ ...mutated(state, project, { screens, selectedId }), ...pushHistory(state, `removeScreen:${id}`) })
    scheduleSave(get)
  },

  moveScreen: (id, delta) => {
    const state = get()
    const from = state.screens.findIndex((s) => s.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= state.screens.length) return
    const screens = [...state.screens]
    const [moved] = screens.splice(from, 1)
    screens.splice(to, 0, moved)
    if (!state.project) return set({ screens, ...pushHistory(state, `moveScreen:${id}`) })
    const slots = [...state.project.set.slots]
    const [movedSlot] = slots.splice(from, 1)
    slots.splice(to, 0, movedSlot)
    const project: Project = {
      set: { ...state.project.set, approval: null, slots },
      copies: state.project.copies,
    }
    set({ ...mutated(state, project, { screens }), ...pushHistory(state, `moveScreen:${id}`) })
    scheduleSave(get)
  },

  setSettings: (patch) => {
    const state = get()
    const kind = `settings:${sortedKeys(patch)}`
    if (!state.project) return set({ settings: { ...state.settings, ...patch }, ...pushHistory(state, kind) })
    // Size and device belong to the target, not to the look every target shares.
    const { sizeId, deviceId, ...shared } = patch
    const targetPatch: Partial<Pick<ProjectTarget, 'sizeId' | 'deviceId'>> = {}
    if (sizeId !== undefined) targetPatch.sizeId = sizeId
    if (deviceId !== undefined) targetPatch.deviceId = deviceId
    const base = Object.keys(targetPatch).length
      ? projectAfterTargetPatch(state.project, state.targetId, targetPatch)
      : state.project
    const project = projectAfterSettings(base, shared)
    set({
      ...mutated(state, project, { settings: settingsFor(project, state.targetId) }),
      ...pushHistory(state, kind),
    })
    scheduleSave(get)
  },

  setFormat: (format) => set({ format }),

  selectedId: null,
  selectScreen: (id) => set({ selectedId: id }),

  setOverride: (id, patch) => {
    const state = get()
    const screens = state.screens.map((s) =>
      s.id === id ? { ...s, overrides: { ...s.overrides, ...patch } } : s,
    )
    const kind = `override:${id}:${sortedKeys(patch)}`
    if (!state.project) return set({ screens, ...pushHistory(state, kind) })
    const project = projectAfterOverride(state.project, id, screens.find((s) => s.id === id)?.overrides ?? {})
    set({ ...mutated(state, project, { screens }), ...pushHistory(state, kind) })
    scheduleSave(get)
  },

  clearOverrides: (id, keys) => {
    const state = get()
    const screens = state.screens.map((s) => {
      if (s.id !== id) return s
      const overrides = { ...s.overrides }
      for (const key of keys) delete overrides[key]
      return { ...s, overrides }
    })
    const kind = `clearOverrides:${id}:${[...keys].sort().join(',')}`
    if (!state.project) return set({ screens, ...pushHistory(state, kind) })
    const project = projectAfterOverride(state.project, id, screens.find((s) => s.id === id)?.overrides ?? {})
    set({ ...mutated(state, project, { screens }), ...pushHistory(state, kind) })
    scheduleSave(get)
  },

  clearSettings: (keys) => {
    const state = get()
    const kind = `clearSettings:${[...keys].sort().join(',')}`
    if (!state.project) {
      const settings = { ...state.settings }
      for (const key of keys) delete settings[key]
      return set({ settings, ...pushHistory(state, kind) })
    }
    const project = projectAfterSettings(state.project, {}, keys)
    set({
      ...mutated(state, project, { settings: settingsFor(project, state.targetId) }),
      ...pushHistory(state, kind),
    })
    scheduleSave(get)
  },

  applyCanvasEdit: (slotId, edit, historyKind) => {
    const state = get()
    if (!state.project) {
      if (edit.kind !== 'settings') return
      const screen = state.screens.find((s) => s.id === slotId)
      const overrides = screen && overridesAfterCanvasEdit(screen.overrides, edit.fields)
      if (!overrides) return
      return set({
        screens: state.screens.map((s) => (s.id === slotId ? { ...s, overrides } : s)),
        ...pushHistory(state, historyKind),
      })
    }
    const project = projectAfterCanvasEdit(state.project, slotId, edit)
    if (!project) return
    set({
      ...mutated(state, project, {
        screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
      }),
      ...pushHistory(state, historyKind),
    })
    scheduleSave(get)
  },

  clearAllOverrides: () => {
    const state = get()
    const screens = state.screens.map((s) => ({ ...s, overrides: {} }))
    if (!state.project) return set({ screens, ...pushHistory(state, 'clearAllOverrides') })
    const project: Project = {
      set: {
        ...state.project.set,
        approval: null,
        slots: state.project.set.slots.map((s) => ({ ...s, overrides: {} })),
      },
      copies: state.project.copies,
    }
    set({ ...mutated(state, project, { screens }), ...pushHistory(state, 'clearAllOverrides') })
    scheduleSave(get)
  },

  // A fresh start, like opening a different project: old snapshots would restore over material
  // nobody edited in this session.
  reset: () => {
    if (get().project) return
    set({ screens: [], images: {}, selectedId: null, ...clearHistory() })
  },

  project: null,
  projectStore: null,
  gallery: {},
  localeId: 'en',
  targetId: '',
  approvalOk: null,
  staleApproval: null,
  lastError: null,
  setLastError: (lastError) => set({ lastError }),

  openProject: async (store) => {
    // A watcher left over from an earlier project must never fire into this one.
    unsubscribe?.()
    unsubscribe = null
    const project = await store.load()
    await preloadScriptFonts(project.set.locales.map((l) => l.id))
    const images = await loadProjectImages(project, store)
    const nodes = await loadProjectNodes(project, store)
    const localeId = project.set.locales[0]?.id ?? 'en'
    const targetId = project.set.targets[0]?.id ?? ''
    set({
      project,
      projectStore: store,
      gallery: readGalleries(project, store),
      images,
      nodes,
      localeId,
      targetId,
      screens: screensFor(project, localeId, nodesLookupOf(nodes)),
      settings: settingsFor(project, targetId),
      selectedId: null,
      step: 'shots',
      staleApproval: null,
      lastError: null,
      ...clearHistory(),
    })
    await get().refreshApproval()
    unsaved = false
    unsubscribe =
      store.subscribe?.(() => {
        // Reloading throws away everything this editor holds. That is fine for a saved project
        // and destroys the work when a save is still pending or has failed.
        if (unsaved) return set({ lastError: OUTSIDE_CHANGE })
        get()
          .reloadProject()
          .catch((error) => console.error('reloading the project failed', error))
      }) ?? null
  },

  reloadProject: async () => {
    const store = get().projectStore
    if (!store) return
    const project = await store.load()
    await preloadScriptFonts(project.set.locales.map((l) => l.id))
    const images = await loadProjectImages(project, store)
    const nodes = await loadProjectNodes(project, store)
    const state = get()
    const localeId = project.set.locales.some((l) => l.id === state.localeId)
      ? state.localeId
      : (project.set.locales[0]?.id ?? 'en')
    const targetId = project.set.targets.some((t) => t.id === state.targetId)
      ? state.targetId
      : (project.set.targets[0]?.id ?? '')
    set({
      project,
      gallery: readGalleries(project, store),
      images,
      nodes,
      localeId,
      targetId,
      screens: screensFor(project, localeId, nodesLookupOf(nodes)),
      settings: settingsFor(project, targetId),
      selectedId: project.set.slots.some((s) => s.id === state.selectedId) ? state.selectedId : null,
      // Someone else wrote the set; old undo/redo snapshots would restore over their change.
      ...clearHistory(),
    })
    unsaved = false
    await get().refreshApproval()
  },

  setLocale: (localeId) =>
    set((state) =>
      state.project
        ? { localeId, screens: screensFor(state.project, localeId, nodesLookupOf(state.nodes)) }
        : state,
    ),

  setTarget: (targetId) =>
    set((state) => (state.project ? { targetId, settings: settingsFor(state.project, targetId) } : state)),

  setCopy: (localeId, slotId, patch) => {
    const state = get()
    if (!state.project) return
    const project = projectAfterScreenPatch(state.project, localeId, slotId, patch)
    set({
      ...mutated(state, project, {
        screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
      }),
      ...pushHistory(state, `copy:${localeId}:${slotId}:${sortedKeys(patch)}`),
    })
    scheduleSave(get)
  },

  setChipText: (localeId, slotId, chipId, text) => {
    const state = get()
    if (!state.project) return
    const project = projectAfterChipPatch(state.project, localeId, slotId, chipId, text)
    set({
      ...mutated(state, project, {
        screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
      }),
      ...pushHistory(state, `chip:${localeId}:${slotId}:${chipId}`),
    })
    scheduleSave(get)
  },

  // Feedback for the regenerating agent, not the document — it stays out of the approval hash
  // (see `projectAfterNote`) and, for the same reason, out of undo/redo.
  setSlotNote: (slotId, note) => {
    const state = get()
    if (!state.project) return
    set({ project: projectAfterNote(state.project, slotId, note) })
    scheduleSave(get)
  },

  setSlotRole: (slotId, role) => {
    const state = get()
    if (!state.project) return
    const project = projectAfterRole(state.project, slotId, role)
    set({ project, ...pushHistory(state, `role:${slotId}`) })
    scheduleSave(get)
  },

  setSlotSource: async (slotId, role, name) => {
    const state = get()
    const store = state.projectStore
    if (!state.project || !store) return
    const project = projectAfterSlotSource(state.project, slotId, role, name)
    set({
      ...mutated(state, project, {
        screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
      }),
      ...pushHistory(state, `slotSource:${slotId}:${role}`),
    })
    scheduleSave(get)
    if (!name) return
    const fresh = await loadNewSources(project, store, get().images, name, role)
    if (Object.keys(fresh).length) set({ images: { ...get().images, ...fresh } })
  },

  loadBackgroundImage: async (src) => {
    const id = backgroundIdFor(src)
    const have = get().images[id]
    if (have) return have
    const url = get().projectStore?.backgroundUrl?.(src)
    if (!url) return null
    try {
      const img = await loadImageUrl(url)
      set({ images: { ...get().images, [id]: img } })
      return img
    } catch (error) {
      console.warn(`background image missing for ${src}`, error)
      return null
    }
  },

  setSlotElements: async (slotId, elements) => {
    const state = get()
    const store = state.projectStore
    if (!state.project || !store) return
    const project = projectAfterSlotElements(state.project, slotId, elements)
    set({
      ...mutated(state, project, {
        screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
      }),
      ...pushHistory(state, `elements:${slotId}`),
    })
    scheduleSave(get)
    // Stickers share the artwork role's loading path — a newly picked artwork is fetched for
    // every language the same way a slot's own artwork would be. A shape names no artwork.
    const names = [...new Set(elements.filter(isSlotSticker).map((el) => el.artwork))]
    const fresh: Record<string, HTMLImageElement> = {}
    for (const name of names)
      Object.assign(fresh, await loadNewSources(project, store, get().images, name, 'artwork'))
    if (Object.keys(fresh).length) set({ images: { ...get().images, ...fresh } })
  },

  setSlotExtra: async (slotId, extra) => {
    const state = get()
    const store = state.projectStore
    if (!state.project || !store) return
    const project = projectAfterSlotExtra(state.project, slotId, extra)
    set({
      ...mutated(state, project, {
        screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
      }),
      ...pushHistory(state, `extra:${slotId}`),
    })
    scheduleSave(get)
    // An extra cell names a plain screen, resolved exactly like the slot's own `screen`.
    const fresh: Record<string, HTMLImageElement> = {}
    for (const name of [...new Set(extra)])
      Object.assign(fresh, await loadNewSources(project, store, get().images, name, 'screen'))
    if (Object.keys(fresh).length) set({ images: { ...get().images, ...fresh } })
  },

  addSlot: async () => {
    const state = get()
    const store = state.projectStore
    if (!state.project || !store) return
    // A tile without a picture cannot be exported, so it starts on whatever the language has.
    const screen = state.gallery[state.localeId]?.screens[0]
    if (!screen) return set({ lastError: 'No source images to put in a new tile' })
    const id = freeSlotId(
      state.project.set.slots.map((slot) => slot.id),
      screen,
    )
    const project = projectAfterSlotAdd(state.project, id, screen)
    set({
      ...mutated(state, project, {
        screens: screensFor(project, state.localeId, nodesLookupOf(state.nodes)),
        selectedId: id,
        lastError: null,
      }),
      ...pushHistory(state, 'addSlot'),
    })
    scheduleSave(get)
    const fresh = await loadNewSources(project, store, get().images, screen, 'screen')
    if (Object.keys(fresh).length) set({ images: { ...get().images, ...fresh } })
  },

  updateTarget: (id, patch) => {
    const state = get()
    if (!state.project) return
    const project = projectAfterTargetPatch(state.project, id, patch)
    set({
      ...mutated(state, project, { settings: settingsFor(project, state.targetId) }),
      ...pushHistory(state, `target:${id}:${sortedKeys(patch)}`),
    })
    scheduleSave(get)
  },

  approve: async (by) => {
    const { project, projectStore } = get()
    if (!project || !projectStore) return
    const hash = await approvalHash(
      project,
      (l, s) => projectStore.sourceBytes(l, s),
      projectStore.artworkBytes?.bind(projectStore),
      nodesBytesOf(projectStore),
      projectStore.backgroundBytes?.bind(projectStore),
    )
    // An edit while the hash was computing wins; approving the older project would be a lie.
    if (get().project !== project) return
    const next: Project = {
      ...project,
      set: { ...project.set, approval: { hash, by, at: new Date().toISOString() } },
    }
    // A stamp the files never received is worse than no stamp: the CLI would still refuse
    // and the GUI would claim the set was approved.
    try {
      await projectStore.save(next)
    } catch (error) {
      set({ lastError: `Approval not saved: ${describeError(error)}` })
      return
    }
    if (get().project !== project) return
    set({ project: next, approvalOk: true, staleApproval: null, lastError: null })
  },

  refreshApproval: async () => {
    const { project, projectStore } = get()
    if (!project || !projectStore) return set({ approvalOk: null })
    if (!project.set.approval) return set({ approvalOk: false })
    const hash = await approvalHash(
      project,
      (l, s) => projectStore.sourceBytes(l, s),
      projectStore.artworkBytes?.bind(projectStore),
      nodesBytesOf(projectStore),
      projectStore.backgroundBytes?.bind(projectStore),
    )
    if (get().project !== project) return
    const ok = hash === project.set.approval.hash
    // A stamp that no longer matches the files is stale in exactly the sense an edit makes it.
    set({ approvalOk: ok, staleApproval: ok ? null : project.set.approval })
  },

  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,

  undo: () => {
    const state = get()
    const previous = state.undoStack[state.undoStack.length - 1]
    if (!previous) return
    const undoStack = state.undoStack.slice(0, -1)
    const redoStack = [...state.redoStack, snapshotOf(state)].slice(-HISTORY_LIMIT)
    // The undo itself is not an edit to coalesce with whatever comes next.
    lastEditKind = null
    set({
      ...applySnapshot(state, previous),
      undoStack,
      redoStack,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    })
    if (state.project) scheduleSave(get)
  },

  redo: () => {
    const state = get()
    const next = state.redoStack[state.redoStack.length - 1]
    if (!next) return
    const redoStack = state.redoStack.slice(0, -1)
    const undoStack = [...state.undoStack, snapshotOf(state)].slice(-HISTORY_LIMIT)
    lastEditKind = null
    set({
      ...applySnapshot(state, next),
      undoStack,
      redoStack,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    })
    if (state.project) scheduleSave(get)
  },
}))

// The last net: a reload or a closed tab drops everything the editor holds, and a failed save
// makes that likely rather than rare.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (unsaved) event.preventDefault()
  })
}

// Automation handle: lets an agent (Argent/CDP) or the devtools console drive the editor
// without synthesising drag-and-drop. Kept in packaged builds too — this is a local tool
// with no untrusted content, and scripting it is a feature rather than an exposure.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}
