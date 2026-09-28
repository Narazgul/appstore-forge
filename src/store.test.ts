import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COALESCE_MS,
  DEFAULT_SETTINGS,
  HISTORY_LIMIT,
  projectAfterNote,
  projectAfterOverride,
  projectAfterScreenPatch,
  projectAfterSlotAdd,
  projectAfterSlotElements,
  projectAfterSlotRemoval,
  projectAfterSlotSource,
  projectAfterTargetPatch,
  projectAfterTemplate,
  slotCount,
  templateSettings,
  useStore,
  variantFor,
  describeError,
  freeSlotId,
  hasUnsavedWork,
  OUTSIDE_CHANGE,
  SAVE_FAILED,
} from './store'
import { screensFor, settingsFor } from './project/bridge'
import { TEMPLATES, getTemplateSpec } from './presets/templates'
import type { ProjectStore } from './project/store'
import type { Project } from './project/types'
import type { TemplateSpec } from './types'

const withVariants = TEMPLATES.find((t) => t.variants?.length)!
const freeform: TemplateSpec = { ...withVariants, variants: undefined }

describe('variantFor', () => {
  it('cycles the variant list so screen n+len matches screen n', () => {
    const len = withVariants.variants!.length
    expect(variantFor(withVariants, len)).toEqual(variantFor(withVariants, 0))
  })

  it('is empty for a template with no variants', () => {
    expect(variantFor(freeform, 0)).toEqual({})
  })

  it('returns a fresh object, so editing one screen cannot leak into another', () => {
    const a = variantFor(withVariants, 0)
    const b = variantFor(withVariants, 0)
    expect(a).not.toBe(b)
  })
})

describe('slotCount', () => {
  it('is one slot per variant for a set template', () => {
    expect(slotCount(withVariants)).toBe(withVariants.variants!.length)
  })

  it('is zero — freeform — when a template has no variants', () => {
    expect(slotCount(freeform)).toBe(0)
  })
})

describe('templateSettings', () => {
  const current = { ...DEFAULT_SETTINGS, sizeId: 'android-phone', deviceId: 'pixel-9-pro', tilt: 12 }

  it('keeps the export size and device the user picked', () => {
    const next = templateSettings(getTemplateSpec(TEMPLATES[0].id), current)
    expect(next.sizeId).toBe('android-phone')
    expect(next.deviceId).toBe('pixel-9-pro')
  })

  it('resets anything the template does not set back to the defaults', () => {
    const template = TEMPLATES.find((t) => t.settings.tilt === undefined)!
    expect(templateSettings(template, current).tilt).toBe(DEFAULT_SETTINGS.tilt)
  })

  it("applies the template's own look on top", () => {
    const template = TEMPLATES.find((t) => t.settings.fontId)!
    expect(templateSettings(template, current).fontId).toBe(template.settings.fontId)
  })
})

const project = (): Project => ({
  set: {
    version: 1,
    id: 'default',
    targets: [
      { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'o/{storeLocale}/{n}.png' },
    ],
    locales: [{ id: 'en', store: { appstore: 'en-US' } }],
    sources: 's/{locale}/{screen}.png',
    settings: {},
    slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
    approval: { hash: 'h', by: 'x', at: 't' },
  },
  copies: { en: { a: { headline: 'Hi', subhead: '' } } },
})

describe('projectAfterScreenPatch', () => {
  it('writes headline and subhead into the locale copy and drops the approval', () => {
    const next = projectAfterScreenPatch(project(), 'en', 'a', { headline: 'New', subhead: 'Sub' })
    expect(next.copies.en.a).toEqual({ headline: 'New', subhead: 'Sub' })
    expect(next.set.approval).toBeNull()
  })

  it('creates the locale copy when it does not exist yet', () => {
    const next = projectAfterScreenPatch(project(), 'de', 'a', { headline: 'Neu' })
    expect(next.copies.de.a).toEqual({ headline: 'Neu', subhead: '' })
  })

  it('does not mutate the input', () => {
    const p = project()
    projectAfterScreenPatch(p, 'en', 'a', { headline: 'New' })
    expect(p.copies.en.a.headline).toBe('Hi')
  })

  it('writes a non-empty eyebrow', () => {
    const next = projectAfterScreenPatch(project(), 'en', 'a', { eyebrow: 'New' })
    expect(next.copies.en.a).toEqual({ headline: 'Hi', subhead: '', eyebrow: 'New' })
  })

  it('drops the eyebrow key instead of persisting an empty string', () => {
    const withEyebrow = projectAfterScreenPatch(project(), 'en', 'a', { eyebrow: 'New' })
    const cleared = projectAfterScreenPatch(withEyebrow, 'en', 'a', { eyebrow: '' })
    expect(cleared.copies.en.a).toEqual({ headline: 'Hi', subhead: '' })
    expect('eyebrow' in cleared.copies.en.a).toBe(false)
  })

  it('writes a non-empty list', () => {
    const next = projectAfterScreenPatch(project(), 'en', 'a', { list: ['Budget', 'Sparziele'] })
    expect(next.copies.en.a).toEqual({ headline: 'Hi', subhead: '', list: ['Budget', 'Sparziele'] })
  })

  it('drops the list key instead of persisting an empty array', () => {
    const withList = projectAfterScreenPatch(project(), 'en', 'a', { list: ['Budget'] })
    const cleared = projectAfterScreenPatch(withList, 'en', 'a', { list: [] })
    expect(cleared.copies.en.a).toEqual({ headline: 'Hi', subhead: '' })
    expect('list' in cleared.copies.en.a).toBe(false)
  })
})

describe('projectAfterOverride', () => {
  it('replaces the slot overrides and drops the approval', () => {
    const next = projectAfterOverride(project(), 'a', { layout: 'hero' })
    expect(next.set.slots[0].overrides).toEqual({ layout: 'hero' })
    expect(next.set.approval).toBeNull()
  })
})

describe('projectAfterTemplate', () => {
  const template = TEMPLATES.find((t) => t.variants?.length && t.settings.fontId)!
  const { sizeId: _s, deviceId: _d, ...base } = DEFAULT_SETTINGS

  it('lays the template look over the defaults, without size and device', () => {
    const next = projectAfterTemplate(project(), template)
    expect(next.set.settings).toEqual({ ...base, ...template.settings })
    expect(next.set.settings).not.toHaveProperty('sizeId')
    expect(next.set.settings).not.toHaveProperty('deviceId')
  })

  it('pins the variant for each existing slot and drops the approval', () => {
    const next = projectAfterTemplate(project(), template)
    expect(next.set.slots[0].overrides).toEqual(variantFor(template, 0))
    expect(next.set.approval).toBeNull()
  })

  it('never adds or removes slots', () => {
    const next = projectAfterTemplate(project(), template)
    expect(next.set.slots).toHaveLength(1)
  })

  it('does not mutate the input', () => {
    const p = project()
    projectAfterTemplate(p, template)
    expect(p.set.settings).toEqual({})
    expect(p.set.approval).not.toBeNull()
  })
})

describe('projectAfterTargetPatch', () => {
  it('patches the named target and drops the approval', () => {
    const next = projectAfterTargetPatch(project(), 'appstore', { sizeId: 'android-phone' })
    expect(next.set.targets[0]).toEqual({
      id: 'appstore',
      sizeId: 'android-phone',
      deviceId: 'iphone-17-pro',
      out: 'o/{storeLocale}/{n}.png',
    })
    expect(next.set.approval).toBeNull()
  })

  it('leaves other targets alone', () => {
    const p = project()
    p.set.targets.push({ id: 'play', sizeId: 'android-phone', deviceId: 'pixel-9-pro', out: 'p/{n}.png' })
    const next = projectAfterTargetPatch(p, 'appstore', { deviceId: 'pixel-9-pro' })
    expect(next.set.targets[1]).toEqual(p.set.targets[1])
  })

  it('does not mutate the input', () => {
    const p = project()
    projectAfterTargetPatch(p, 'appstore', { sizeId: 'android-phone' })
    expect(p.set.targets[0].sizeId).toBe('iphone-6-9')
    expect(p.set.approval).not.toBeNull()
  })
})

describe('projectAfterNote', () => {
  it('writes the note and keeps the approval, which does not cover notes', () => {
    const next = projectAfterNote(project(), 'a', 'Headline too long')
    expect(next.set.slots[0].note).toBe('Headline too long')
    expect(next.set.approval).toEqual(project().set.approval)
  })

  it('removes the key again for an empty note', () => {
    const next = projectAfterNote(projectAfterNote(project(), 'a', 'x'), 'a', '')
    expect(next.set.slots[0]).not.toHaveProperty('note')
  })

  it('leaves other slots alone and does not mutate the input', () => {
    const p = project()
    p.set.slots.push({ id: 'b', kind: 'screen', screen: 'two', overrides: {} })
    const next = projectAfterNote(p, 'b', 'Swap the shot')
    expect(next.set.slots[0]).not.toHaveProperty('note')
    expect(p.set.slots[1]).not.toHaveProperty('note')
  })
})

describe('freeSlotId', () => {
  it('takes the screen name when it is free', () => {
    expect(freeSlotId(['a'], 'budget_screen')).toBe('budget_screen')
  })

  it('counts up instead of colliding', () => {
    expect(freeSlotId(['budget_screen'], 'budget_screen')).toBe('budget_screen-2')
    expect(freeSlotId(['budget_screen', 'budget_screen-2'], 'budget_screen')).toBe('budget_screen-3')
  })

  it('strips what a file name may not carry, and never returns nothing', () => {
    expect(freeSlotId([], 'a b/c.png')).toBe('a-b-c-png')
    expect(freeSlotId([], '///')).toBe('slot')
  })
})

describe('projectAfterSlotAdd', () => {
  it('appends the tile and drops the approval', () => {
    const next = projectAfterSlotAdd(project(), 'league', 'league_screen')
    expect(next.set.slots.map((s) => s.id)).toEqual(['a', 'league'])
    expect(next.set.slots[1]).toEqual({
      id: 'league',
      kind: 'screen',
      screen: 'league_screen',
      overrides: {},
    })
    expect(next.set.approval).toBeNull()
  })

  it('leaves the copies alone — the new tile has none yet', () => {
    const next = projectAfterSlotAdd(project(), 'league', 'league_screen')
    expect(next.copies).toEqual(project().copies)
  })

  it('does not mutate the input', () => {
    const p = project()
    projectAfterSlotAdd(p, 'league', 'league_screen')
    expect(p.set.slots).toHaveLength(1)
  })
})

describe('projectAfterSlotSource', () => {
  it('puts a picked image into the slot`s own frame and drops the approval', () => {
    const next = projectAfterSlotSource(project(), 'a', 'screen', 'budget_screen_dark')
    expect(next.set.slots[0].screen).toBe('budget_screen_dark')
    expect(next.set.approval).toBeNull()
  })

  it('names the partner frames', () => {
    const p = projectAfterSlotSource(project(), 'a', 'pair', 'right')
    const next = projectAfterSlotSource(p, 'a', 'pairPrev', 'left')
    expect(next.set.slots[0].pair).toBe('right')
    expect(next.set.slots[0].pairPrev).toBe('left')
  })

  it('removes an optional frame`s key, which hands it back to the neighbour', () => {
    const p = projectAfterSlotSource(project(), 'a', 'pair', 'right')
    expect(projectAfterSlotSource(p, 'a', 'pair', null).set.slots[0]).not.toHaveProperty('pair')
  })

  it('keeps the screen when clearing it, because every slot needs one', () => {
    expect(projectAfterSlotSource(project(), 'a', 'screen', null).set.slots[0].screen).toBe('shot')
  })

  it('leaves other slots alone and does not mutate the input', () => {
    const p = project()
    p.set.slots.push({ id: 'b', kind: 'screen', screen: 'two', overrides: {} })
    const next = projectAfterSlotSource(p, 'b', 'artwork', 'pain-points')
    expect(next.set.slots[0]).not.toHaveProperty('artwork')
    expect(p.set.slots[1]).not.toHaveProperty('artwork')
  })
})

describe('projectAfterSlotElements', () => {
  it('writes the sticker list and drops the approval', () => {
    const elements = [{ id: 's', artwork: 'dot', x: 0.5, y: 0.75, width: 0.3 }]
    const next = projectAfterSlotElements(project(), 'a', elements)
    expect(next.set.slots[0].elements).toEqual(elements)
    expect(next.set.approval).toBeNull()
  })

  it('removes the key entirely for an empty list, rather than persisting elements: []', () => {
    const withStickers = projectAfterSlotElements(project(), 'a', [
      { id: 's', artwork: 'dot', x: 0.5, y: 0.75, width: 0.3 },
    ])
    const next = projectAfterSlotElements(withStickers, 'a', [])
    expect(next.set.slots[0]).not.toHaveProperty('elements')
  })

  it('leaves other slots alone and does not mutate the input', () => {
    const p = project()
    p.set.slots.push({ id: 'b', kind: 'screen', screen: 'two', overrides: {} })
    const next = projectAfterSlotElements(p, 'b', [{ id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.2 }])
    expect(next.set.slots[0]).not.toHaveProperty('elements')
    expect(p.set.slots[1]).not.toHaveProperty('elements')
  })

  describe('a chip dropped from the list', () => {
    const withChip = (): Project => {
      const p = project()
      p.set.slots[0].elements = [{ id: 'pill', chip: true, x: 0.5, y: 0.2, width: 0.3 }]
      p.copies.en.a = { headline: 'Hi', subhead: '', chips: { pill: '+312 € saved' } }
      p.copies.de = { a: { headline: 'Hallo', subhead: '', chips: { pill: '+312 € gespart' } } }
      return p
    }

    it('takes its copy with it, in every locale, in the same step', () => {
      const next = projectAfterSlotElements(withChip(), 'a', [])
      expect(next.copies.en.a).toEqual({ headline: 'Hi', subhead: '' })
      expect(next.copies.de.a).toEqual({ headline: 'Hallo', subhead: '' })
    })

    it('never persists an empty chips object', () => {
      const next = projectAfterSlotElements(withChip(), 'a', [])
      expect(next.copies.en.a).not.toHaveProperty('chips')
    })

    it('leaves a surviving chip’s copy untouched', () => {
      const p = withChip()
      const kept = p.set.slots[0].elements![0]
      const next = projectAfterSlotElements(p, 'a', [
        kept,
        { id: 's', artwork: 'dot', x: 0.5, y: 0.75, width: 0.3 },
      ])
      expect(next.copies.en.a.chips).toEqual({ pill: '+312 € saved' })
    })

    it('drops only the removed chip’s text, keeping a surviving chip’s own', () => {
      const p = withChip()
      p.set.slots[0].elements!.push({ id: 'pill2', chip: true, x: 0.5, y: 0.4, width: 0.3 })
      p.copies.en.a.chips!.pill2 = 'Second'
      const next = projectAfterSlotElements(p, 'a', [{ id: 'pill2', chip: true, x: 0.5, y: 0.4, width: 0.3 }])
      expect(next.copies.en.a.chips).toEqual({ pill2: 'Second' })
    })

    it('leaves a locale with no copy for the slot untouched', () => {
      const p = withChip()
      p.copies.fr = {}
      const next = projectAfterSlotElements(p, 'a', [])
      expect(next.copies.fr).toEqual({})
    })

    it('does not mutate the input project', () => {
      const p = withChip()
      projectAfterSlotElements(p, 'a', [])
      expect(p.copies.en.a.chips).toEqual({ pill: '+312 € saved' })
    })
  })
})

describe('projectAfterSlotRemoval', () => {
  const twoSlots = (): Project => {
    const p = project()
    p.set.slots.push({ id: 'b', kind: 'screen', screen: 'two', overrides: {} })
    p.copies.en.b = { headline: 'Zwei', subhead: '' }
    p.copies.de = { a: { headline: 'Eins', subhead: '' }, b: { headline: 'Zwei', subhead: '' } }
    return p
  }

  it('drops the slot and its copy in every locale, and the approval', () => {
    const next = projectAfterSlotRemoval(twoSlots(), 'a')
    expect(next.set.slots.map((s) => s.id)).toEqual(['b'])
    expect(next.copies.en).toEqual({ b: { headline: 'Zwei', subhead: '' } })
    expect(next.copies.de).toEqual({ b: { headline: 'Zwei', subhead: '' } })
    expect(next.set.approval).toBeNull()
  })

  it('does not mutate the input', () => {
    const p = twoSlots()
    projectAfterSlotRemoval(p, 'a')
    expect(p.set.slots).toHaveLength(2)
    expect(p.copies.de.a).toEqual({ headline: 'Eins', subhead: '' })
  })
})

describe('the store in project mode', () => {
  const open = (p: Project) => {
    useStore.setState({
      project: p,
      localeId: 'en',
      targetId: 'appstore',
      screens: screensFor(p, 'en'),
      settings: settingsFor(p, 'appstore'),
      approvalOk: true,
      selectedId: null,
      staleApproval: null,
      lastError: null,
    })
  }

  afterEach(() => {
    useStore.setState({
      project: null,
      projectStore: null,
      screens: [],
      images: {},
      approvalOk: null,
      staleApproval: null,
      lastError: null,
    })
  })

  it('clearAllOverrides empties every slot and drops the approval', () => {
    const p = project()
    p.set.slots[0].overrides = { layout: 'hero' }
    p.set.slots.push({ id: 'b', kind: 'screen', screen: 'two', overrides: { tilt: 4 } })
    open(p)
    useStore.getState().clearAllOverrides()
    const state = useStore.getState()
    expect(state.project!.set.slots.map((s) => s.overrides)).toEqual([{}, {}])
    expect(state.screens.map((s) => s.overrides)).toEqual([{}, {}])
    expect(state.project!.set.approval).toBeNull()
    expect(state.approvalOk).toBe(false)
  })

  it('setSettings routes size and device to the target, the rest into the shared look', () => {
    open(project())
    useStore.getState().setSettings({ sizeId: 'ipad-13', deviceId: 'pixel-9-pro', tilt: 7 })
    const state = useStore.getState()
    expect(state.project!.set.targets[0]).toMatchObject({ sizeId: 'ipad-13', deviceId: 'pixel-9-pro' })
    expect(state.project!.set.settings).toEqual({ tilt: 7 })
    expect(state.project!.set.settings).not.toHaveProperty('sizeId')
    expect(state.project!.set.settings).not.toHaveProperty('deviceId')
  })

  it('setSettings never leaves a size in the local settings the project does not record', () => {
    open(project())
    useStore.getState().setSettings({ sizeId: 'ipad-13' })
    const state = useStore.getState()
    expect(state.settings.sizeId).toBe(state.project!.set.targets[0].sizeId)
    expect(state.settings.deviceId).toBe(state.project!.set.targets[0].deviceId)
  })

  // Compatibility: an old set's file never carried `accentBar`/`subheadStyle`. Editing an
  // unrelated key must not write them in either — only touching those controls should, exactly
  // like every other setting (see rules.md, rule 8: undefined-means-inherit).
  it('editing an unrelated setting on an old project never writes accentBar or subheadStyle', () => {
    open(project())
    useStore.getState().setSettings({ tilt: 3 })
    const settings = useStore.getState().project!.set.settings
    expect(settings).toEqual({ tilt: 3 })
    expect(settings).not.toHaveProperty('accentBar')
    expect(settings).not.toHaveProperty('subheadStyle')
  })

  it('an old project with neither key resolves to the pre-feature defaults (accentBar off, subheadStyle plain)', () => {
    open(project())
    const state = useStore.getState()
    expect(state.settings.accentBar).toBeNull()
    expect(state.settings.subheadStyle).toBe('plain')
  })

  it('removeScreen drops the slot and its copy in every locale', () => {
    const p = project()
    p.copies.de = { a: { headline: 'Eins', subhead: '' } }
    open(p)
    useStore.getState().removeScreen('a')
    const state = useStore.getState()
    expect(state.project!.set.slots).toEqual([])
    expect(state.project!.copies.en).toEqual({})
    expect(state.project!.copies.de).toEqual({})
    expect(state.screens).toEqual([])
    expect(state.approvalOk).toBe(false)
  })

  it('setSlotNote writes the note without touching the approval', () => {
    const p = project()
    open(p)
    useStore.setState({ approvalOk: true, staleApproval: null })
    useStore.getState().setSlotNote('a', 'Headline too long')
    const state = useStore.getState()
    expect(state.project!.set.slots[0].note).toBe('Headline too long')
    expect(state.project!.set.approval).toEqual(p.set.approval)
    expect(state.approvalOk).toBe(true)
    expect(state.staleApproval).toBeNull()
  })

  it('clearImage and reset keep their hands off a project', () => {
    open(project())
    useStore.getState().clearImage('a')
    useStore.getState().reset()
    const state = useStore.getState()
    expect(state.project).not.toBeNull()
    expect(state.screens.map((s) => s.imageId)).toEqual(['en/shot'])
  })
})

/** A canvas-free Image: it resolves through the load events the store now waits for. */
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(url: string) {
    queueMicrotask(() => (missingSources.has(url) ? this.onerror?.() : this.onload?.()))
  }
}

const missingSources = new Set<string>()

const twoSlotProject = (): Project => {
  const p = project()
  p.set.approval = null
  p.set.locales.push({ id: 'de', store: { appstore: 'de-DE' } })
  p.set.slots.push({ id: 'b', kind: 'screen', screen: 'two', overrides: {} })
  return p
}

const fakeProjectStore = (p: Project, save?: () => Promise<void>): ProjectStore => ({
  load: () => Promise.resolve(p),
  save: save ?? (() => Promise.resolve()),
  sourceUrl: (localeId, screen) => `/sources/${localeId}/${screen}.png`,
  sourceBytes: (localeId, screen) => Promise.resolve(new TextEncoder().encode(`${localeId}/${screen}`)),
  artworkUrl: (localeId, artwork) => `/artwork/${localeId}/${artwork}.png`,
  artworkBytes: (localeId, artwork) => Promise.resolve(new TextEncoder().encode(`${localeId}/${artwork}`)),
})

describe('opening a project with a missing source', () => {
  afterEach(() => {
    missingSources.clear()
    vi.unstubAllGlobals()
    useStore.setState({
      project: null,
      projectStore: null,
      screens: [],
      images: {},
      approvalOk: null,
      staleApproval: null,
      lastError: null,
    })
  })

  const stubBrowser = () => {
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('document', {
      fonts: { load: () => Promise.resolve([]), ready: Promise.resolve(), check: () => true },
    })
  }

  it('opens with the images that did load and leaves the failed key absent', async () => {
    stubBrowser()
    missingSources.add('/sources/de/two.png')
    const p = twoSlotProject()
    await useStore.getState().openProject(fakeProjectStore(p))
    const state = useStore.getState()
    expect(state.project).toBe(p)
    expect(Object.keys(state.images).sort()).toEqual(['de/shot', 'en/shot', 'en/two'])
    expect(state.images['de/two']).toBeUndefined()
    expect(state.screens.map((s) => s.imageId)).toEqual(['en/shot', 'en/two'])
  })

  it('still opens when no source at all can be loaded', async () => {
    stubBrowser()
    for (const url of ['/sources/en/shot.png', '/sources/en/two.png']) missingSources.add(url)
    missingSources.add('/sources/de/shot.png')
    missingSources.add('/sources/de/two.png')
    await useStore.getState().openProject(fakeProjectStore(twoSlotProject()))
    expect(useStore.getState().images).toEqual({})
    expect(useStore.getState().screens).toHaveLength(2)
  })
})

describe('approve', () => {
  afterEach(() => {
    useStore.setState({
      project: null,
      projectStore: null,
      approvalOk: null,
      staleApproval: null,
      lastError: null,
    })
  })

  const open = (p: Project, store: ProjectStore) => {
    useStore.setState({
      project: p,
      projectStore: store,
      localeId: 'en',
      targetId: 'appstore',
      screens: screensFor(p, 'en'),
      settings: settingsFor(p, 'appstore'),
      approvalOk: false,
      staleApproval: null,
      lastError: null,
    })
  }

  it('stamps the project only after the save came back', async () => {
    const p = twoSlotProject()
    open(p, fakeProjectStore(p))
    await useStore.getState().approve('Hofi')
    const state = useStore.getState()
    expect(state.approvalOk).toBe(true)
    expect(state.project!.set.approval).toMatchObject({ by: 'Hofi' })
    expect(state.lastError).toBeNull()
    expect(state.staleApproval).toBeNull()
  })

  it('keeps the approval unset and reports the failure when the save rejects', async () => {
    const p = twoSlotProject()
    open(
      p,
      fakeProjectStore(p, () => Promise.reject(new Error('disk full'))),
    )
    await useStore.getState().approve('Hofi')
    const state = useStore.getState()
    expect(state.approvalOk).toBe(false)
    expect(state.project!.set.approval).toBeNull()
    expect(state.lastError).toMatch(/disk full/)
  })
})

describe('setSlotElements', () => {
  const open = (p: Project, store: ProjectStore) => {
    useStore.setState({
      project: p,
      projectStore: store,
      localeId: 'en',
      targetId: 'appstore',
      screens: screensFor(p, 'en'),
      settings: settingsFor(p, 'appstore'),
      images: {},
      approvalOk: true,
      selectedId: null,
      staleApproval: null,
      lastError: null,
    })
  }

  /** The debounce is a timer, the save a promise: both have to be flushed (see 'the automatic save'). */
  const flush = async () => {
    vi.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('document', {
      fonts: { load: () => Promise.resolve([]), ready: Promise.resolve(), check: () => true },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useStore.setState({
      project: null,
      projectStore: null,
      screens: [],
      images: {},
      approvalOk: null,
      staleApproval: null,
      lastError: null,
    })
  })

  it('writes the sticker list into the slot, drops the approval and saves the project', async () => {
    const p = project()
    let saved: Project | null = null
    open(
      p,
      fakeProjectStore(p, async () => {
        saved = useStore.getState().project
      }),
    )
    const elements = [{ id: 's', artwork: 'dot', x: 0.5, y: 0.75, width: 0.3 }]
    await useStore.getState().setSlotElements('a', elements)
    const state = useStore.getState()
    expect(state.project!.set.slots[0].elements).toEqual(elements)
    expect(state.project!.set.approval).toBeNull()
    expect(state.approvalOk).toBe(false)
    await flush()
    expect(saved!.set.slots[0].elements).toEqual(elements)
  })

  it('loads the sticker image into the registry for every locale', async () => {
    const p = twoSlotProject()
    open(p, fakeProjectStore(p))
    await useStore.getState().setSlotElements('a', [{ id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.2 }])
    const state = useStore.getState()
    expect(Object.keys(state.images).sort()).toEqual(['artwork/de/dot', 'artwork/en/dot'])
  })

  it('removes the key entirely once the list is emptied', async () => {
    const p = project()
    open(p, fakeProjectStore(p))
    await useStore.getState().setSlotElements('a', [{ id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.2 }])
    await useStore.getState().setSlotElements('a', [])
    expect(useStore.getState().project!.set.slots[0]).not.toHaveProperty('elements')
  })
})

describe('staleApproval', () => {
  afterEach(() => {
    useStore.setState({
      project: null,
      projectStore: null,
      approvalOk: null,
      staleApproval: null,
      lastError: null,
    })
  })

  it('keeps the stamp a mutation dropped, and keeps it over the next mutation', () => {
    const p = project()
    useStore.setState({
      project: p,
      localeId: 'en',
      targetId: 'appstore',
      screens: screensFor(p, 'en'),
      settings: settingsFor(p, 'appstore'),
      approvalOk: true,
      staleApproval: null,
    })
    useStore.getState().setCopy('en', 'a', { headline: 'Neu' })
    expect(useStore.getState().staleApproval).toEqual({ hash: 'h', by: 'x', at: 't' })
    useStore.getState().setCopy('en', 'a', { headline: 'Neuer' })
    expect(useStore.getState().staleApproval).toEqual({ hash: 'h', by: 'x', at: 't' })
    expect(useStore.getState().approvalOk).toBe(false)
  })
})

describe('the automatic save', () => {
  afterEach(() => {
    vi.useRealTimers()
    useStore.setState({
      project: null,
      projectStore: null,
      screens: [],
      approvalOk: null,
      staleApproval: null,
      lastError: null,
    })
  })

  const open = (p: Project, store: ProjectStore) =>
    useStore.setState({
      project: p,
      projectStore: store,
      localeId: 'en',
      targetId: 'appstore',
      screens: screensFor(p, 'en'),
      settings: settingsFor(p, 'appstore'),
      approvalOk: true,
      staleApproval: null,
      lastError: null,
    })

  /** The debounce is a timer, the save a promise: both have to be flushed. */
  const flush = async () => {
    vi.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
  }

  it('reports a rejected save instead of swallowing it', async () => {
    vi.useFakeTimers()
    const p = project()
    open(
      p,
      fakeProjectStore(p, () => Promise.reject(new Error('permission denied'))),
    )
    useStore.getState().setCopy('en', 'a', { headline: 'Neu' })
    await flush()
    expect(useStore.getState().lastError).toMatch(/permission denied/)
    expect(useStore.getState().lastError).toContain(SAVE_FAILED)
  })

  it('clears its own message once a later save comes back', async () => {
    vi.useFakeTimers()
    const p = project()
    let fail = true
    open(
      p,
      fakeProjectStore(p, () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve())),
    )
    useStore.getState().setCopy('en', 'a', { headline: 'Eins' })
    await flush()
    expect(useStore.getState().lastError).toMatch(/offline/)
    fail = false
    useStore.getState().setCopy('en', 'a', { headline: 'Zwei' })
    await flush()
    expect(useStore.getState().lastError).toBeNull()
  })

  it('leaves an unrelated message alone', async () => {
    vi.useFakeTimers()
    const p = project()
    open(p, fakeProjectStore(p))
    useStore.setState({ lastError: 'Approval not saved: something else' })
    useStore.getState().setCopy('en', 'a', { headline: 'Neu' })
    await flush()
    expect(useStore.getState().lastError).toBe('Approval not saved: something else')
  })
})

describe('an outside change while this editor holds unsaved work', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    missingSources.clear()
    useStore.setState({
      project: null,
      projectStore: null,
      screens: [],
      images: {},
      approvalOk: null,
      staleApproval: null,
      lastError: null,
    })
  })

  /** A store whose subscribe handle the test can fire, standing in for another writer. */
  const watchable = (p: Project, save?: () => Promise<void>) => {
    let fire: (() => void) | null = null
    return {
      store: {
        ...fakeProjectStore(p, save),
        subscribe: (onChange: () => void) => {
          fire = onChange
          return () => (fire = null)
        },
      } as ProjectStore,
      outsideWrite: () => fire?.(),
    }
  }

  const openIt = async (store: ProjectStore) => {
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('document', {
      fonts: { load: () => Promise.resolve([]), ready: Promise.resolve(), check: () => true },
    })
    await useStore.getState().openProject(store)
  }

  it('reloads when everything is saved', async () => {
    const p = project()
    const { store, outsideWrite } = watchable(p)
    await openIt(store)
    expect(hasUnsavedWork()).toBe(false)
    outsideWrite()
    await Promise.resolve()
    expect(useStore.getState().lastError).toBeNull()
  })

  it('refuses to reload over a save that has not come back, and says so', async () => {
    vi.useFakeTimers()
    const p = project()
    const { store, outsideWrite } = watchable(p, () => new Promise(() => undefined))
    await openIt(store)
    useStore.getState().setCopy('en', 'a', { headline: 'Meine Arbeit' })
    expect(hasUnsavedWork()).toBe(true)
    outsideWrite()
    expect(useStore.getState().lastError).toBe(OUTSIDE_CHANGE)
    // The point of the guard: the edit is still there.
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Meine Arbeit')
  })

  it('still holds the work after a save failed', async () => {
    vi.useFakeTimers()
    const p = project()
    const { store, outsideWrite } = watchable(p, () => Promise.reject(new Error('permission denied')))
    await openIt(store)
    useStore.getState().setCopy('en', 'a', { headline: 'Meine Arbeit' })
    vi.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
    expect(useStore.getState().lastError).toMatch(SAVE_FAILED)
    outsideWrite()
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Meine Arbeit')
  })
})

describe('undo / redo', () => {
  // Each test starts its own fake clock, comfortably past the wall-clock time any earlier test
  // (in this file, real- or fake-clocked) could have left in the module-private `lastEditAt` —
  // otherwise a leftover coalescing window could bleed into this block's first edit.
  let clock = 0
  const COALESCED = 100
  const APART = COALESCE_MS + 1

  const open = (p: Project, store: ProjectStore) =>
    useStore.setState({
      project: p,
      projectStore: store,
      localeId: 'en',
      targetId: 'appstore',
      screens: screensFor(p, 'en'),
      settings: settingsFor(p, 'appstore'),
      images: {},
      approvalOk: true,
      selectedId: null,
      staleApproval: null,
      lastError: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    })

  const flush = async () => {
    vi.runAllTimers()
    await Promise.resolve()
    await Promise.resolve()
  }

  beforeEach(() => {
    clock = Math.max(clock, Date.now()) + 10 * COALESCE_MS
    vi.useFakeTimers()
    vi.setSystemTime(clock)
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('document', {
      fonts: { load: () => Promise.resolve([]), ready: Promise.resolve(), check: () => true },
    })
  })

  afterEach(() => {
    clock = Math.max(clock, Date.now()) // captures however far a test advanced the fake clock
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useStore.setState({
      project: null,
      projectStore: null,
      screens: [],
      images: {},
      approvalOk: null,
      staleApproval: null,
      lastError: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    })
  })

  it('undo restores the previous document, redo re-applies it, and a new edit after undo clears redo', () => {
    const p = project()
    open(p, fakeProjectStore(p))

    useStore.getState().setCopy('en', 'a', { headline: 'Neu' })
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Neu')
    expect(useStore.getState().canUndo).toBe(true)
    expect(useStore.getState().canRedo).toBe(false)

    useStore.getState().undo()
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Hi')
    expect(useStore.getState().canUndo).toBe(false)
    expect(useStore.getState().canRedo).toBe(true)

    useStore.getState().redo()
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Neu')
    expect(useStore.getState().canUndo).toBe(true)
    expect(useStore.getState().canRedo).toBe(false)

    useStore.getState().undo()
    useStore.getState().setCopy('en', 'a', { headline: 'Anders' })
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Anders')
    expect(useStore.getState().canRedo).toBe(false)
    useStore.getState().redo()
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Anders')
  })

  it('undo schedules a save and always leaves the approval null, even if the snapshot had one', async () => {
    const p = project() // p.set.approval = { hash: 'h', by: 'x', at: 't' }
    let saved: Project | null = null
    open(
      p,
      fakeProjectStore(p, async () => {
        saved = useStore.getState().project
      }),
    )
    useStore.getState().setCopy('en', 'a', { headline: 'Neu' })
    expect(useStore.getState().project!.set.approval).toBeNull()

    useStore.getState().undo()
    const state = useStore.getState()
    expect(state.project!.copies.en.a.headline).toBe('Hi')
    // The pre-edit snapshot's own `approval` was the original stamp — undo must not resurrect it.
    expect(state.project!.set.approval).toBeNull()

    await flush()
    expect(saved!.copies.en.a.headline).toBe('Hi')
    expect(saved!.set.approval).toBeNull()
  })

  it('coalesces consecutive edits of the same kind inside the window into one step', () => {
    const p = project()
    open(p, fakeProjectStore(p))
    useStore.getState().setCopy('en', 'a', { headline: 'A' })
    vi.advanceTimersByTime(COALESCED)
    useStore.getState().setCopy('en', 'a', { headline: 'AB' })
    vi.advanceTimersByTime(COALESCED)
    useStore.getState().setCopy('en', 'a', { headline: 'ABC' })
    expect(useStore.getState().undoStack).toHaveLength(1)
    useStore.getState().undo()
    expect(useStore.getState().project!.copies.en.a.headline).toBe('Hi')
  })

  it('a different kind starts a new step even inside the window', () => {
    const p = project()
    open(p, fakeProjectStore(p))
    useStore.getState().setCopy('en', 'a', { headline: 'A' })
    vi.advanceTimersByTime(COALESCED)
    useStore.getState().setCopy('en', 'a', { subhead: 'Sub' })
    expect(useStore.getState().undoStack).toHaveLength(2)
  })

  it('an edit after the coalescing window starts a new step', () => {
    const p = project()
    open(p, fakeProjectStore(p))
    useStore.getState().setCopy('en', 'a', { headline: 'A' })
    vi.advanceTimersByTime(APART)
    useStore.getState().setCopy('en', 'a', { headline: 'AB' })
    expect(useStore.getState().undoStack).toHaveLength(2)
  })

  it('caps the undo stack at HISTORY_LIMIT entries', () => {
    const p = project()
    open(p, fakeProjectStore(p))
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      useStore.getState().setCopy('en', 'a', { headline: `H${i}` })
      vi.advanceTimersByTime(APART)
    }
    expect(useStore.getState().undoStack).toHaveLength(HISTORY_LIMIT)
  })

  it('locale, target, selection and step changes are not recorded', () => {
    const p = twoSlotProject()
    open(p, fakeProjectStore(p))
    useStore.getState().setLocale('de')
    useStore.getState().setTarget('appstore')
    useStore.getState().selectScreen('a')
    useStore.getState().setStep('review')
    expect(useStore.getState().undoStack).toHaveLength(0)
    expect(useStore.getState().canUndo).toBe(false)
  })

  it('the approve action itself is not recorded', async () => {
    const p = project()
    open(p, fakeProjectStore(p))
    await useStore.getState().approve('Hofi')
    expect(useStore.getState().undoStack).toHaveLength(0)
  })

  it('an outside change clears both stacks', async () => {
    const p = project()
    const outside: { fire: (() => void) | null } = { fire: null }
    const store: ProjectStore = {
      ...fakeProjectStore(p),
      subscribe: (onChange) => {
        outside.fire = onChange
        return () => (outside.fire = null)
      },
    }
    await useStore.getState().openProject(store)
    useStore.getState().setCopy('en', 'a', { headline: 'Neu' })
    await flush() // clears `unsaved`, or the outside change would refuse to reload
    expect(useStore.getState().canUndo).toBe(true)

    outside.fire?.()
    // `reloadProject()` runs un-awaited from the subscription callback (store.ts fires and
    // forgets); give its chain of awaits (load, fonts, images) enough microtask ticks to settle.
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(useStore.getState().undoStack).toHaveLength(0)
    expect(useStore.getState().redoStack).toHaveLength(0)
    expect(useStore.getState().canUndo).toBe(false)
  })

  it('opening a project clears both stacks', async () => {
    const p = project()
    open(p, fakeProjectStore(p))
    useStore.getState().setCopy('en', 'a', { headline: 'Neu' })
    expect(useStore.getState().canUndo).toBe(true)

    await useStore.getState().openProject(fakeProjectStore(project()))
    expect(useStore.getState().undoStack).toHaveLength(0)
    expect(useStore.getState().canUndo).toBe(false)
  })

  it('switching to a different set is not an undoable edit', async () => {
    const p = project()
    open(p, fakeProjectStore(p))
    useStore.getState().setCopy('en', 'a', { headline: 'Neu' })
    expect(useStore.getState().canUndo).toBe(true)

    // `openSet` in an adapter navigates away; in the GUI that means a fresh `openProject` call
    // against the new set, exactly like opening any other project — nothing about the target
    // being a *different* set id needs its own history handling.
    const otherSet = { ...project(), set: { ...project().set, id: 'promo' } }
    await useStore.getState().openProject(fakeProjectStore(otherSet))
    expect(useStore.getState().project?.set.id).toBe('promo')
    expect(useStore.getState().undoStack).toHaveLength(0)
    expect(useStore.getState().redoStack).toHaveLength(0)
    expect(useStore.getState().canUndo).toBe(false)
    expect(useStore.getState().canRedo).toBe(false)
  })

  it('sticker edits (setSlotElements) are undoable', async () => {
    const p = project()
    open(p, fakeProjectStore(p))
    await useStore.getState().setSlotElements('a', [{ id: 's', artwork: 'dot', x: 0.5, y: 0.5, width: 0.2 }])
    expect(useStore.getState().project!.set.slots[0].elements).toHaveLength(1)

    useStore.getState().undo()
    expect(useStore.getState().project!.set.slots[0]).not.toHaveProperty('elements')
  })

  it('removing a chip drops its copy in the same step, and undo restores both together', async () => {
    const p = project()
    p.set.slots[0].elements = [{ id: 'pill', chip: true, x: 0.5, y: 0.2, width: 0.3 }]
    p.copies.en.a = { headline: 'Hi', subhead: '', chips: { pill: '+312 € saved' } }
    open(p, fakeProjectStore(p))

    await useStore.getState().setSlotElements('a', [])
    expect(useStore.getState().project!.set.slots[0]).not.toHaveProperty('elements')
    expect(useStore.getState().project!.copies.en.a).not.toHaveProperty('chips')

    useStore.getState().undo()
    expect(useStore.getState().project!.set.slots[0].elements).toEqual(p.set.slots[0].elements)
    expect(useStore.getState().project!.copies.en.a.chips).toEqual({ pill: '+312 € saved' })

    useStore.getState().redo()
    expect(useStore.getState().project!.set.slots[0]).not.toHaveProperty('elements')
    expect(useStore.getState().project!.copies.en.a).not.toHaveProperty('chips')
  })

  it('copy edits including the eyebrow are undoable', () => {
    const p = project()
    open(p, fakeProjectStore(p))
    useStore.getState().setCopy('en', 'a', { eyebrow: 'New' })
    expect(useStore.getState().project!.copies.en.a.eyebrow).toBe('New')

    useStore.getState().undo()
    expect(useStore.getState().project!.copies.en.a).not.toHaveProperty('eyebrow')
  })

  it('a list edit through updateScreen is undoable', () => {
    const p = project()
    open(p, fakeProjectStore(p))
    useStore.getState().updateScreen('a', { list: ['Budget', 'Sparziele'] })
    expect(useStore.getState().project!.copies.en.a.list).toEqual(['Budget', 'Sparziele'])
    expect(useStore.getState().screens[0].list).toEqual(['Budget', 'Sparziele'])

    useStore.getState().undo()
    expect(useStore.getState().project!.copies.en.a).not.toHaveProperty('list')
  })
})

describe('describeError', () => {
  it('keeps the Firestore code, which names the cause the message hides', () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    })
    expect(describeError(denied)).toBe('Missing or insufficient permissions. (permission-denied)')
  })

  it('falls back to the plain message when there is no code', () => {
    expect(describeError(new Error('offline'))).toBe('offline')
    expect(describeError('something')).toBe('something')
  })
})
