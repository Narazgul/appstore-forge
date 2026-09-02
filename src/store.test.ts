import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  projectAfterOverride,
  projectAfterScreenPatch,
  projectAfterSlotRemoval,
  projectAfterTargetPatch,
  projectAfterTemplate,
  slotCount,
  templateSettings,
  useStore,
  variantFor,
} from './store'
import { screensFor, settingsFor } from './project/bridge'
import { TEMPLATES, getTemplateSpec } from './presets/templates'
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
    })
  }

  afterEach(() => {
    useStore.setState({ project: null, projectStore: null, screens: [], images: {}, approvalOk: null })
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

  it('clearImage and reset keep their hands off a project', () => {
    open(project())
    useStore.getState().clearImage('a')
    useStore.getState().reset()
    const state = useStore.getState()
    expect(state.project).not.toBeNull()
    expect(state.screens.map((s) => s.imageId)).toEqual(['en/shot'])
  })
})
