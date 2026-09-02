import { create } from 'zustand'
import { preloadScriptFonts } from './presets/fonts'
import { getRhythm, rhythmStep } from './presets/rhythms'
import { getTemplateSpec } from './presets/templates'
import { imageIdFor, screensFor, settingsFor } from './project/bridge'
import { approvalHash } from './project/hash'
import type { ProjectStore } from './project/store'
import type { Project, ProjectCopies, ProjectTarget, SlotCopy } from './project/types'
import type { Screen, ScreenOverrides, Settings, TemplateSpec } from './types'

/** The guided flow. Steps are navigation and status, never a gate — any step is one click away. */
export type StepId = 'target' | 'look' | 'shots' | 'copy' | 'tune' | 'review'
export const STEPS: StepId[] = ['target', 'look', 'shots', 'copy', 'tune', 'review']

/** Cosmetic store-page details for the preview; nothing here reaches the exported pixels. */
export type Listing = { name: string; subtitle: string; developer: string; category: string }

let seq = 0
const nextId = () => `s${++seq}`

export const DEFAULT_SETTINGS: Settings = {
  background: { kind: 'solid', color: '#eaf2ff' },
  backdropColor: null,
  deviceId: 'iphone-17-pro',
  frameColorId: 'deep-blue',
  positionId: 'center',
  layout: 'text-top',
  tilt: 0,
  deviceScale: 1,
  textColor: '#111114',
  textAlign: 'center',
  highlights: ['#ffe27a'],
  fontId: 'inter',
  headlineScale: 1,
  subheadScale: 1,
  headlineTracking: -0.01,
  sizeId: 'iphone-6-9',
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
  return {
    set: { ...project.set, approval: null },
    copies: { ...project.copies, [localeId]: { ...locale, [screenId]: { ...current, ...patch } } },
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
  clearAllOverrides: () => void
  reset: () => void
  /** null in freeform mode: no project on disk, everything lives in this store */
  project: Project | null
  projectStore: ProjectStore | null
  localeId: string
  targetId: string
  /** null = nothing to judge, false = edited since the last approval */
  approvalOk: boolean | null
  openProject: (store: ProjectStore) => Promise<void>
  /** re-read the project after an outside change, keeping where the user is */
  reloadProject: () => Promise<void>
  setLocale: (id: string) => void
  setTarget: (id: string) => void
  setCopy: (localeId: string, slotId: string, patch: Partial<SlotCopy>) => void
  updateTarget: (id: string, patch: Partial<Pick<ProjectTarget, 'sizeId' | 'deviceId'>>) => void
  approve: (by: string) => Promise<void>
  refreshApproval: () => Promise<void>
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = URL.createObjectURL(file)
  await img.decode()
  return img
}

async function loadImageUrl(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = url
  await img.decode()
  return img
}

async function loadProjectImages(
  project: Project,
  store: ProjectStore,
): Promise<Record<string, HTMLImageElement>> {
  const images: Record<string, HTMLImageElement> = {}
  await Promise.all(
    project.set.locales.flatMap((l) =>
      project.set.slots.map(async (s) => {
        images[imageIdFor(l.id, s.screen)] = await loadImageUrl(store.sourceUrl(l.id, s.screen))
      }),
    ),
  )
  return images
}

let unsubscribe: (() => void) | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(get: () => State) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { project, projectStore } = get()
    if (project && projectStore) void projectStore.save(project)
  }, 300)
}

export const useStore = create<State>((set, get) => ({
  screens: [],
  images: {},
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
    if (!state.project) return set({ rhythmId: rhythm.id, screens })
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
      rhythmId: rhythm.id,
      project,
      screens: screensFor(project, state.localeId),
      approvalOk: false,
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
        templateId: template.id,
        rhythmId,
        project,
        screens: screensFor(project, state.localeId),
        settings: settingsFor(project, state.targetId),
        approvalOk: false,
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
    })
  },

  addFiles: async (files) => {
    // In project mode the screenshots come from the project's sources, not from a drop.
    if (get().project) return
    const usable = files.filter((f) => f.type.startsWith('image/'))
    if (!usable.length) return
    const loaded = await Promise.all(usable.map(async (file) => ({ file, img: await loadImage(file) })))
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
      return { images, screens }
    })
  },

  setImage: async (id, file) => {
    if (get().project) return
    if (!file.type.startsWith('image/')) return
    const img = await loadImage(file)
    set((state) => {
      const imageId = nextId()
      return {
        images: { ...state.images, [imageId]: img },
        screens: state.screens.map((s) => (s.id === id ? { ...s, imageId } : s)),
      }
    })
  },

  clearImage: (id) => {
    if (get().project) return
    set((state) => ({ screens: state.screens.map((s) => (s.id === id ? { ...s, imageId: null } : s)) }))
  },

  updateScreen: (id, patch) => {
    const state = get()
    const screens = state.screens.map((s) => (s.id === id ? { ...s, ...patch } : s))
    const copy: Partial<SlotCopy> = {}
    if (patch.headline !== undefined) copy.headline = patch.headline
    if (patch.subhead !== undefined) copy.subhead = patch.subhead
    if (!state.project || (copy.headline === undefined && copy.subhead === undefined)) {
      return set({ screens })
    }
    const project = projectAfterScreenPatch(state.project, state.localeId, id, copy)
    set({ screens, project, approvalOk: false })
    scheduleSave(get)
  },

  removeScreen: (id) => {
    const state = get()
    const screens = state.screens.filter((s) => s.id !== id)
    const selectedId = state.selectedId === id ? null : state.selectedId
    if (!state.project) return set({ screens, selectedId })
    const project = projectAfterSlotRemoval(state.project, id)
    set({ screens, selectedId, project, approvalOk: false })
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
    if (!state.project) return set({ screens })
    const slots = [...state.project.set.slots]
    const [movedSlot] = slots.splice(from, 1)
    slots.splice(to, 0, movedSlot)
    const project: Project = {
      set: { ...state.project.set, approval: null, slots },
      copies: state.project.copies,
    }
    set({ screens, project, approvalOk: false })
    scheduleSave(get)
  },

  setSettings: (patch) => {
    const state = get()
    if (!state.project) return set({ settings: { ...state.settings, ...patch } })
    // Size and device belong to the target, not to the look every target shares.
    const { sizeId, deviceId, ...shared } = patch
    const targetPatch: Partial<Pick<ProjectTarget, 'sizeId' | 'deviceId'>> = {}
    if (sizeId !== undefined) targetPatch.sizeId = sizeId
    if (deviceId !== undefined) targetPatch.deviceId = deviceId
    const base = Object.keys(targetPatch).length
      ? projectAfterTargetPatch(state.project, state.targetId, targetPatch)
      : state.project
    const project: Project = {
      set: { ...base.set, approval: null, settings: { ...base.set.settings, ...shared } },
      copies: base.copies,
    }
    set({ project, settings: settingsFor(project, state.targetId), approvalOk: false })
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
    if (!state.project) return set({ screens })
    const project = projectAfterOverride(state.project, id, screens.find((s) => s.id === id)?.overrides ?? {})
    set({ screens, project, approvalOk: false })
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
    if (!state.project) return set({ screens })
    const project = projectAfterOverride(state.project, id, screens.find((s) => s.id === id)?.overrides ?? {})
    set({ screens, project, approvalOk: false })
    scheduleSave(get)
  },

  clearAllOverrides: () => {
    const state = get()
    const screens = state.screens.map((s) => ({ ...s, overrides: {} }))
    if (!state.project) return set({ screens })
    const project: Project = {
      set: {
        ...state.project.set,
        approval: null,
        slots: state.project.set.slots.map((s) => ({ ...s, overrides: {} })),
      },
      copies: state.project.copies,
    }
    set({ screens, project, approvalOk: false })
    scheduleSave(get)
  },

  reset: () => {
    if (get().project) return
    set({ screens: [], images: {}, selectedId: null })
  },

  project: null,
  projectStore: null,
  localeId: 'en',
  targetId: '',
  approvalOk: null,

  openProject: async (store) => {
    // A watcher left over from an earlier project must never fire into this one.
    unsubscribe?.()
    unsubscribe = null
    const project = await store.load()
    await preloadScriptFonts(project.set.locales.map((l) => l.id))
    const images = await loadProjectImages(project, store)
    const localeId = project.set.locales[0]?.id ?? 'en'
    const targetId = project.set.targets[0]?.id ?? ''
    set({
      project,
      projectStore: store,
      images,
      localeId,
      targetId,
      screens: screensFor(project, localeId),
      settings: settingsFor(project, targetId),
      selectedId: null,
      step: 'shots',
    })
    await get().refreshApproval()
    unsubscribe =
      store.subscribe?.(() => {
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
    const state = get()
    const localeId = project.set.locales.some((l) => l.id === state.localeId)
      ? state.localeId
      : (project.set.locales[0]?.id ?? 'en')
    const targetId = project.set.targets.some((t) => t.id === state.targetId)
      ? state.targetId
      : (project.set.targets[0]?.id ?? '')
    set({
      project,
      images,
      localeId,
      targetId,
      screens: screensFor(project, localeId),
      settings: settingsFor(project, targetId),
      selectedId: project.set.slots.some((s) => s.id === state.selectedId) ? state.selectedId : null,
    })
    await get().refreshApproval()
  },

  setLocale: (localeId) =>
    set((state) => (state.project ? { localeId, screens: screensFor(state.project, localeId) } : state)),

  setTarget: (targetId) =>
    set((state) => (state.project ? { targetId, settings: settingsFor(state.project, targetId) } : state)),

  setCopy: (localeId, slotId, patch) => {
    const state = get()
    if (!state.project) return
    const project = projectAfterScreenPatch(state.project, localeId, slotId, patch)
    set({ project, screens: screensFor(project, state.localeId), approvalOk: false })
    scheduleSave(get)
  },

  updateTarget: (id, patch) => {
    const state = get()
    if (!state.project) return
    const project = projectAfterTargetPatch(state.project, id, patch)
    set({ project, settings: settingsFor(project, state.targetId), approvalOk: false })
    scheduleSave(get)
  },

  approve: async (by) => {
    const { project, projectStore } = get()
    if (!project || !projectStore) return
    const hash = await approvalHash(project, (l, s) => projectStore.sourceBytes(l, s))
    // An edit while the hash was computing wins; approving the older project would be a lie.
    if (get().project !== project) return
    const next: Project = {
      ...project,
      set: { ...project.set, approval: { hash, by, at: new Date().toISOString() } },
    }
    set({ project: next, approvalOk: true })
    await projectStore.save(next)
  },

  refreshApproval: async () => {
    const { project, projectStore } = get()
    if (!project || !projectStore) return set({ approvalOk: null })
    if (!project.set.approval) return set({ approvalOk: false })
    const hash = await approvalHash(project, (l, s) => projectStore.sourceBytes(l, s))
    if (get().project !== project) return
    set({ approvalOk: hash === project.set.approval.hash })
  },
}))

// Automation handle: lets an agent (Argent/CDP) or the devtools console drive the editor
// without synthesising drag-and-drop. Kept in packaged builds too — this is a local tool
// with no untrusted content, and scripting it is a feature rather than an exposure.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}
