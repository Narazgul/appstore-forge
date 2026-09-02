import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  projectAfterOverride,
  projectAfterScreenPatch,
  projectAfterTargetPatch,
  projectAfterTemplate,
  slotCount,
  templateSettings,
  variantFor,
} from './store'
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
