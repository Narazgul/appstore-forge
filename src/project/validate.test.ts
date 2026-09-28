import { describe, expect, it } from 'vitest'
import { AA_LARGE_TEXT, AA_NORMAL_TEXT, contrastAgainstBackground, contrastRatio } from '../lib/contrast'
import { validateProject } from './validate'
import type { Project, ProjectLocale, SlotCopy, SlotElement, SlotShape } from './types'

/** Mirrors the message/level branching in validate.ts, for fixtures built to land in one branch. */
const expectedContrastMessage = (label: string, ratio: number, surface: string) =>
  `${label} contrast ${ratio.toFixed(1)}:1 on ${surface} (needs ${ratio < AA_LARGE_TEXT ? AA_LARGE_TEXT : AA_NORMAL_TEXT}:1)`
const expectedContrastLevel = (ratio: number): 'error' | 'warn' => (ratio < AA_LARGE_TEXT ? 'error' : 'warn')

const base = (): Project => ({
  set: {
    version: 1,
    id: 'default',
    targets: [
      { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'out/{storeLocale}/{n}.png' },
    ],
    locales: [{ id: 'en', store: { appstore: 'en-US' } }],
    sources: 'src/{locale}/{screen}.png',
    settings: {},
    slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
    approval: null,
  },
  copies: { en: { a: { headline: 'Hi', subhead: '' } } },
})
const always = () => true

describe('validateProject', () => {
  it('passes a complete project', () => {
    expect(validateProject(base(), always)).toEqual([])
  })

  it('flags a missing source image as an error with slot and locale', () => {
    const issues = validateProject(base(), () => false)
    expect(issues).toEqual([
      { level: 'error', message: 'Source image missing: src/en/shot.png', slot: 'a', locale: 'en' },
    ])
  })

  it('flags a slot without headline for a locale', () => {
    const p = base()
    p.copies.en = {}
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Headline missing',
      slot: 'a',
      locale: 'en',
    })
  })

  it('flags a copy entry without a headline instead of crashing', () => {
    const p = base()
    p.copies.en.a = { subhead: '' } as SlotCopy
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Headline missing',
      slot: 'a',
      locale: 'en',
    })
  })

  it('flags a locale without a store map instead of crashing', () => {
    const p = base()
    delete (p.set.locales[0] as Partial<ProjectLocale>).store
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'No store locale for target appstore',
      locale: 'en',
    })
  })

  it('flags copy for a slot that does not exist', () => {
    const p = base()
    p.copies.en.ghost = { headline: 'x', subhead: '' }
    expect(validateProject(p, always)).toContainEqual({
      level: 'warn',
      message: 'Copy for unknown slot',
      slot: 'ghost',
      locale: 'en',
    })
  })

  it('flags a locale without a store code for a target', () => {
    const p = base()
    p.set.locales[0].store = {}
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'No store locale for target appstore',
      locale: 'en',
    })
  })

  it('flags unknown size, device and duplicate slot ids', () => {
    const p = base()
    p.set.targets[0].sizeId = 'nope'
    p.set.targets[0].deviceId = 'nope'
    p.set.slots.push({ id: 'a', kind: 'screen', screen: 'shot', overrides: {} })
    const messages = validateProject(p, always).map((i) => i.message)
    expect(messages).toContain('Unknown size nope')
    expect(messages).toContain('Unknown device nope')
    expect(messages).toContain('Duplicate slot id a')
  })

  it('reports an open note as a warning', () => {
    const p = base()
    p.set.slots[0].note = ' Headline too long '
    expect(validateProject(p, always)).toEqual([
      { level: 'warn', message: 'Open feedback: Headline too long', slot: 'a' },
    ])
  })

  it('stays silent on an empty note', () => {
    const p = base()
    p.set.slots[0].note = '   '
    expect(validateProject(p, always)).toEqual([])
  })

  it('flags a slot whose arrangement needs an artwork but names none', () => {
    const p = base()
    p.set.slots[0].overrides = { positionId: 'duo-artwork' }
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Arrangement duo-artwork needs an artwork, but the slot names none',
      slot: 'a',
    })
  })

  it('takes the arrangement from the set settings when the slot overrides nothing', () => {
    const p = base()
    p.set.settings = { positionId: 'duo-artwork' }
    expect(validateProject(p, always).map((i) => i.message)).toContain(
      'Arrangement duo-artwork needs an artwork, but the slot names none',
    )
  })

  it('flags an artwork file that is not there', () => {
    const p = base()
    p.set.slots[0].artwork = 'pain-points'
    expect(validateProject(p, always, () => false)).toContainEqual({
      level: 'error',
      message: 'Artwork image missing: aso/artwork/pain-points.png',
      slot: 'a',
    })
  })

  it('names the language too when the artwork template is per-language', () => {
    const p = base()
    p.set.artworkSources = 'art/{locale}/{artwork}.png'
    p.set.slots[0].artwork = 'pain-points'
    expect(validateProject(p, always, () => false)).toContainEqual({
      level: 'error',
      message: 'Artwork image missing: art/en/pain-points.png',
      slot: 'a',
      locale: 'en',
    })
  })

  it('accepts a slot whose artwork is there', () => {
    const p = base()
    p.set.slots[0].artwork = 'pain-points'
    p.set.slots[0].overrides = { positionId: 'duo-artwork' }
    expect(validateProject(p, always, always)).toEqual([])
  })

  it('insists on an {artwork} placeholder in the template', () => {
    const p = base()
    p.set.artworkSources = 'aso/artwork/fixed.png'
    expect(validateProject(p, always).map((i) => i.message)).toContain(
      'artworkSources must contain {artwork}',
    )
  })

  it('flags a missing source for the paired screen', () => {
    const p = base()
    p.set.slots[0].pair = 'other'
    expect(validateProject(p, (_l, screen) => screen !== 'other')).toContainEqual({
      level: 'error',
      message: 'Source image missing: src/en/other.png',
      slot: 'a',
      locale: 'en',
    })
  })

  it('accepts a pair whose source is there', () => {
    const p = base()
    p.set.slots[0].pair = 'other'
    expect(validateProject(p, always)).toEqual([])
  })

  it('rejects an artwork slot that still names a screen', () => {
    const p = base()
    p.set.slots[0].kind = 'artwork'
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Artwork slot must not name a screen',
      slot: 'a',
    })
  })

  it('rejects an artwork slot that names a pair or pairPrev', () => {
    const p = base()
    p.set.slots[0] = { id: 'a', kind: 'artwork', pair: 'x', pairPrev: 'y', overrides: {} }
    const issues = validateProject(p, always)
    expect(issues).toContainEqual({ level: 'error', message: 'Artwork slot must not name a pair', slot: 'a' })
    expect(issues).toContainEqual({
      level: 'error',
      message: 'Artwork slot must not name a pairPrev',
      slot: 'a',
    })
  })

  it('accepts a bare artwork slot with copy and warns without one', () => {
    const p = base()
    p.set.slots[0] = { id: 'a', kind: 'artwork', overrides: {} }
    expect(validateProject(p, always)).toEqual([])

    p.copies.en.a = { headline: '', subhead: '' }
    expect(validateProject(p, always)).toContainEqual({
      level: 'warn',
      message: 'Artwork slot has neither stickers nor any copy',
      slot: 'a',
    })
  })

  it('does not warn about a bare artwork slot that carries stickers', () => {
    const p = base()
    p.set.slots[0] = {
      id: 'a',
      kind: 'artwork',
      overrides: {},
      elements: [{ id: 'e', artwork: 'mascot', x: 0.5, y: 0.5, width: 0.3 }],
    }
    p.copies.en.a = { headline: '', subhead: '' }
    expect(validateProject(p, always)).not.toContainEqual(
      expect.objectContaining({ message: 'Artwork slot has neither stickers nor any copy' }),
    )
  })

  it('requires a screen on an ordinary slot', () => {
    const p = base()
    delete (p.set.slots[0] as { screen?: string }).screen
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Slot needs a screen',
      slot: 'a',
    })
  })

  it('allows a missing {n} when the set has exactly one slot at span 1', () => {
    const p = base()
    p.set.targets[0].out = 'out/{storeLocale}/featureGraphic.png'
    p.set.settings = { layout: 'text-top' }
    expect(validateProject(p, always)).toEqual([])
  })

  it('still requires {n} when the one slot is a span-2 layout', () => {
    const p = base()
    p.set.targets[0].out = 'out/{storeLocale}/featureGraphic.png'
    p.set.settings = { layout: 'panorama' }
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Target appstore: out must contain {n} unless the set renders exactly one tile per locale',
    })
  })

  it('requires {n} when the set has more than one slot', () => {
    const p = base()
    p.set.targets[0].out = 'out/{storeLocale}/featureGraphic.png'
    p.set.slots.push({ id: 'b', kind: 'screen', screen: 'shot2', overrides: {} })
    p.copies.en.b = { headline: 'Second', subhead: '' }
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: 'Target appstore: out must contain {n} unless the set renders exactly one tile per locale',
    })
  })

  it('warns, without erroring, when the set font does not cover a locale', () => {
    const p = base()
    p.set.settings = { fontId: 'baloo-2' }
    p.set.locales = [{ id: 'ru', store: { appstore: 'ru-RU' } }]
    p.copies = { ru: { a: { headline: 'Привет', subhead: '' } } }
    const issues = validateProject(p, always)
    expect(issues).toEqual([
      {
        level: 'warn',
        message: 'Font "Baloo 2" does not cover locale "ru"; falls back to Inter',
        locale: 'ru',
      },
    ])
  })

  it('warns for a slot override font that does not cover the locale, not just the global one', () => {
    const p = base()
    p.set.slots[0].overrides = { fontId: 'dm-sans' }
    p.set.locales = [{ id: 'vi', store: { appstore: 'vi-VN' } }]
    p.copies = { vi: { a: { headline: 'Xin chào', subhead: '' } } }
    expect(validateProject(p, always)).toContainEqual({
      level: 'warn',
      message: 'Font "DM Sans" does not cover locale "vi"; falls back to Inter',
      locale: 'vi',
    })
  })

  it('stays quiet when the font covers every locale', () => {
    const p = base()
    p.set.settings = { fontId: 'nunito' }
    p.set.locales = [{ id: 'ru', store: { appstore: 'ru-RU' } }]
    p.copies = { ru: { a: { headline: 'Привет', subhead: '' } } }
    expect(validateProject(p, always)).toEqual([])
  })

  it('is silent about the eyebrow when the check is not wired up', () => {
    const p = base()
    p.copies.en.a.eyebrow = 'New'
    expect(validateProject(p, always)).toEqual([])
  })

  it('flags an eyebrow the injected check reports as not fitting', () => {
    const p = base()
    p.copies.en.a.eyebrow = 'New'
    expect(validateProject(p, always, always, () => false)).toContainEqual({
      level: 'error',
      message: 'Eyebrow does not fit on one line',
      slot: 'a',
      locale: 'en',
    })
  })

  it('never asks the eyebrow check about a slot with no eyebrow', () => {
    const p = base()
    let asked = false
    validateProject(p, always, always, () => {
      asked = true
      return true
    })
    expect(asked).toBe(false)
  })

  it('warns when only some locales of a slot carry an eyebrow', () => {
    const p = base()
    p.set.locales.push({ id: 'de', store: { appstore: 'de-DE' } })
    p.copies.en.a.eyebrow = 'New'
    p.copies.de = { a: { headline: 'Hallo', subhead: '' } }
    expect(validateProject(p, always)).toContainEqual({
      level: 'warn',
      message: 'Eyebrow set for some locales but not others',
      slot: 'a',
    })
  })

  it('stays silent when every locale has the eyebrow, or none does', () => {
    const p = base()
    p.set.locales.push({ id: 'de', store: { appstore: 'de-DE' } })
    p.copies.de = { a: { headline: 'Hallo', subhead: '' } }
    expect(validateProject(p, always).some((i) => i.message.includes('Eyebrow set for some'))).toBe(false)

    p.copies.en.a.eyebrow = 'New'
    p.copies.de.a.eyebrow = 'Neu'
    expect(validateProject(p, always).some((i) => i.message.includes('Eyebrow set for some'))).toBe(false)
  })
})

describe('stickers', () => {
  const sticker = (patch: Partial<SlotElement> = {}): SlotElement => ({
    id: 's',
    artwork: 'dot',
    x: 0.5,
    y: 0.75,
    width: 0.3,
    ...patch,
  })

  it('flags a missing sticker artwork file, worded like a missing slot artwork', () => {
    const p = base()
    p.set.slots[0].elements = [sticker()]
    expect(validateProject(p, always, () => false)).toContainEqual({
      level: 'error',
      message: 'Artwork image missing: aso/artwork/dot.png',
      slot: 'a',
    })
  })

  it('accepts a sticker whose artwork is there', () => {
    const p = base()
    p.set.slots[0].elements = [sticker()]
    expect(validateProject(p, always, always)).toEqual([])
  })

  it('reports a missing artwork file only once for two stickers sharing it', () => {
    const p = base()
    p.set.slots[0].elements = [sticker({ id: 's1' }), sticker({ id: 's2' })]
    const issues = validateProject(p, always, () => false).filter((i) => i.message.startsWith('Artwork'))
    expect(issues).toHaveLength(1)
  })

  it('flags duplicate sticker ids within a slot', () => {
    const p = base()
    p.set.slots[0].elements = [sticker({ id: 'dupe' }), sticker({ id: 'dupe' })]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: 'Duplicate sticker id dupe',
      slot: 'a',
    })
  })

  it('flags a sticker with width <= 0', () => {
    const p = base()
    p.set.slots[0].elements = [sticker({ width: 0 })]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: 'Sticker s has width <= 0',
      slot: 'a',
    })
  })

  it('flags a sticker with a non-finite position, size or rotation', () => {
    const p = base()
    p.set.slots[0].elements = [sticker({ x: NaN })]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: 'Sticker s has a non-finite position, size or rotation',
      slot: 'a',
    })
  })

  it('warns when a front sticker overlaps the layout text band, and names the approximation used', () => {
    const p = base()
    // text-top's band: top 0.065, height 0.165 — a sticker centred well inside it, as a square.
    p.set.slots[0].elements = [sticker({ y: 0.1, width: 0.5, layer: 'front' })]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'warn',
      message:
        'Sticker "s" may cover the headline (box approximated from width as a square, since the image size is not known here)',
      slot: 'a',
    })
  })

  it('uses the real aspect ratio when the check can supply one', () => {
    const p = base()
    p.set.slots[0].elements = [sticker({ y: 0.1, width: 0.5, layer: 'front' })]
    const issues = validateProject(
      p,
      always,
      always,
      () => true,
      () => 2,
    )
    expect(issues).toContainEqual({
      level: 'warn',
      message:
        'Sticker "s" may cover the headline (box approximated from width and the image\'s aspect ratio)',
      slot: 'a',
    })
  })

  it('measures the box height in tile heights, so a square sticker below the band on a tall tile stays quiet', () => {
    const p = base()
    // 0.4 tile widths is only ~0.18 of a 1320×2868 tile's height: the box spans ~0.29–0.47, clear of 0.23.
    p.set.slots[0].elements = [sticker({ y: 0.38, width: 0.4, layer: 'front' })]
    const issues = validateProject(
      p,
      always,
      always,
      () => true,
      () => 1,
    )
    expect(issues.some((i) => i.message.includes('may cover'))).toBe(false)
  })

  it('never warns about a behind sticker, since the text is drawn over it', () => {
    const p = base()
    p.set.slots[0].elements = [sticker({ y: 0.1, width: 0.5, layer: 'behind' })]
    expect(validateProject(p, always, always).some((i) => i.message.includes('may cover'))).toBe(false)
  })

  it('stays quiet about a front sticker that sits away from the text band', () => {
    const p = base()
    p.set.slots[0].elements = [sticker({ y: 0.9, width: 0.1, layer: 'front' })]
    expect(validateProject(p, always, always).some((i) => i.message.includes('may cover'))).toBe(false)
  })
})

describe('shapes', () => {
  const shape = (patch: Partial<SlotShape> = {}): SlotElement => ({
    id: 'kreis',
    shape: 'circle',
    color: '#eaf2ff',
    x: 0.193,
    y: 0.2,
    width: 0.666,
    ...patch,
  })

  it('accepts a well-formed shape and asks for no artwork file at all', () => {
    const p = base()
    p.set.slots[0].elements = [shape()]
    expect(validateProject(p, always, () => false)).toEqual([])
  })

  it.each(['#eaf2ff', '#eaf', '#eaf2ffcc'])('accepts hex color %s', (color) => {
    const p = base()
    p.set.slots[0].elements = [shape({ color })]
    expect(validateProject(p, always, always)).toEqual([])
  })

  it.each(['eaf2ff', '#gggggg', '#ea', 'rgb(1,2,3)', ''])('rejects an invalid hex color %s', (color) => {
    const p = base()
    p.set.slots[0].elements = [shape({ color })]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: `Shape kreis has an invalid color "${color}"`,
      slot: 'a',
    })
  })

  it('flags a shape with width <= 0', () => {
    const p = base()
    p.set.slots[0].elements = [shape({ width: 0 })]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: 'Shape kreis has width <= 0',
      slot: 'a',
    })
  })

  it('flags a shape with a non-finite position, size or rotation', () => {
    const p = base()
    p.set.slots[0].elements = [shape({ x: NaN })]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: 'Shape kreis has a non-finite position, size or rotation',
      slot: 'a',
    })
  })

  it('flags duplicate shape ids within a slot', () => {
    const p = base()
    p.set.slots[0].elements = [shape({ id: 'dupe' }), shape({ id: 'dupe' })]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: 'Duplicate shape id dupe',
      slot: 'a',
    })
  })

  it('never warns about a shape overlapping the text band, even as a front layer covering it fully', () => {
    const p = base()
    // text-top's band: top 0.065, height 0.165 — well inside it either way.
    p.set.slots[0].elements = [shape({ y: 0.1, width: 0.5, layer: 'front' })]
    expect(validateProject(p, always, always).some((i) => i.message.includes('may cover'))).toBe(false)
  })

  it('rejects an element naming neither artwork nor shape', () => {
    const p = base()
    p.set.slots[0].elements = [{ id: 'x', x: 0.5, y: 0.5, width: 0.3 } as SlotElement]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: 'Element x must be exactly one of artwork or shape',
      slot: 'a',
    })
  })

  it('rejects an element naming both artwork and shape', () => {
    const p = base()
    p.set.slots[0].elements = [
      { id: 'x', artwork: 'dot', shape: 'circle', color: '#fff', x: 0.5, y: 0.5, width: 0.3 } as SlotElement,
    ]
    expect(validateProject(p, always, always)).toContainEqual({
      level: 'error',
      message: 'Element x must be exactly one of artwork or shape',
      slot: 'a',
    })
  })
})

describe('contrast', () => {
  it('is silent for the real production colours (background #eaf2ff, textColor #111114, highlights [#ffe27a])', () => {
    const p = base()
    p.set.settings = {
      background: { kind: 'solid', color: '#eaf2ff' },
      textColor: '#111114',
      highlights: ['#ffe27a'],
    }
    p.copies.en.a = { headline: 'Master *your budget*', subhead: 'Every euro gets a job.', eyebrow: 'New' }
    expect(validateProject(p, always).filter((i) => i.message.includes('contrast'))).toEqual([])
  })

  it('a) errors when the headline fails the minimum ratio against a solid background', () => {
    const p = base()
    const background = { kind: 'solid' as const, color: '#222222' }
    const textColor = '#000000'
    p.set.settings = { background, textColor }
    const ratio = contrastAgainstBackground(textColor, background)
    expect(ratio).toBeLessThan(AA_LARGE_TEXT)
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: expectedContrastMessage('Headline', ratio, 'background'),
      slot: 'a',
    })
  })

  it('a) warns, not errors, between the two thresholds — and does not flag a passing headline', () => {
    const p = base()
    const background = { kind: 'solid' as const, color: '#ffffff' }
    const textColor = '#949494'
    p.set.settings = { background, textColor }
    const ratio = contrastAgainstBackground(textColor, background)
    expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT)
    expect(ratio).toBeLessThan(AA_NORMAL_TEXT)
    expect(validateProject(p, always)).toContainEqual({
      level: 'warn',
      message: expectedContrastMessage('Headline', ratio, 'background'),
      slot: 'a',
    })

    // #767676 on white clears AA_NORMAL_TEXT — no issue at all.
    p.set.settings = { background, textColor: '#767676' }
    expect(validateProject(p, always).some((i) => i.message.startsWith('Headline contrast'))).toBe(false)
  })

  it('checks a gradient background against the worse of its two stops', () => {
    const p = base()
    const background = { kind: 'gradient' as const, from: '#ffffff', to: '#eaeaea', angle: 135 }
    const textColor = '#949494'
    p.set.settings = { background, textColor }
    const worse = Math.min(contrastRatio(textColor, background.from), contrastRatio(textColor, background.to))
    // The darker stop is the worse one here — proves the check reads both, not just the first.
    expect(worse).toBe(contrastRatio(textColor, background.to))
    expect(worse).toBeLessThan(contrastRatio(textColor, background.from))
    expect(validateProject(p, always)).toContainEqual({
      level: expectedContrastLevel(worse),
      message: expectedContrastMessage('Headline', worse, 'background'),
      slot: 'a',
    })
  })

  it('b) checks the subhead at its real 0.72 alpha, only when some locale has one', () => {
    const p = base()
    const background = { kind: 'solid' as const, color: '#ffffff' }
    const textColor = '#767676' // opaque ratio ~4.54 passes the headline outright
    p.set.settings = { background, textColor }
    expect(validateProject(p, always).some((i) => i.message.includes('Subhead'))).toBe(false)

    p.copies.en.a.subhead = 'Every euro gets a job.'
    const opaque = contrastAgainstBackground(textColor, background)
    const blended = contrastAgainstBackground(textColor, background, 0.72)
    expect(opaque).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    expect(blended).toBeLessThan(opaque)
    expect(validateProject(p, always)).toContainEqual({
      level: expectedContrastLevel(blended),
      message: expectedContrastMessage('Subhead', blended, 'background'),
      slot: 'a',
    })
  })

  it('c) checks eyebrowColor ?? textColor against the background, only when some locale has one', () => {
    const p = base()
    p.set.settings = {
      background: { kind: 'solid', color: '#ffffff' },
      textColor: '#000000',
      eyebrowColor: '#eeeeee',
    }
    expect(validateProject(p, always).some((i) => i.message.includes('Eyebrow contrast'))).toBe(false)

    p.copies.en.a.eyebrow = 'New'
    const ratio = contrastAgainstBackground('#eeeeee', { kind: 'solid', color: '#ffffff' })
    const issues = validateProject(p, always).filter((i) => i.message.includes('contrast'))
    expect(issues).toEqual([
      {
        level: expectedContrastLevel(ratio),
        message: expectedContrastMessage('Eyebrow', ratio, 'background'),
        slot: 'a',
      },
    ])
  })

  it('d) checks textColor against a highlight only when a starred span actually uses it', () => {
    const p = base()
    p.set.settings = {
      background: { kind: 'solid', color: '#ffffff' },
      textColor: '#000000',
      highlights: ['#000000', '#f2f2f2'], // span 0 (used) fails; span 1 (unused) would pass anyway
    }
    p.copies.en.a.headline = 'Master *your* budget'
    const ratio = contrastRatio('#000000', '#000000')
    expect(validateProject(p, always)).toContainEqual({
      level: expectedContrastLevel(ratio),
      message: expectedContrastMessage('Headline', ratio, 'highlight'),
      slot: 'a',
    })
  })

  it('d) never flags a highlight colour no locale’s headline puts a starred span on', () => {
    const p = base()
    p.set.settings = {
      background: { kind: 'solid', color: '#ffffff' },
      textColor: '#000000',
      highlights: ['#f2f2f2', '#0d0d0d'], // span 1 would fail, but nothing uses it
    }
    p.copies.en.a.headline = 'Plain headline, no stars'
    expect(validateProject(p, always).some((i) => i.message.includes('highlight'))).toBe(false)
  })

  it('d) cycles highlights by span index like the renderer, and looks at every locale', () => {
    const p = base()
    p.set.locales.push({ id: 'de', store: { appstore: 'de-DE' } })
    p.set.settings = {
      background: { kind: 'solid', color: '#ffffff' },
      textColor: '#000000',
      highlights: ['#f2f2f2', '#0d0d0d'],
    }
    // en only reaches span 0 (fine); de's second star reaches span 1 (fails) — only visible by
    // looking at every locale's headline, not just the active one.
    p.copies.en.a.headline = 'Master *your* budget'
    p.copies.de = { a: { headline: 'Meistere *dein* *Budget*', subhead: '' } }
    const bad = contrastRatio('#000000', '#0d0d0d')
    const issues = validateProject(p, always).filter((i) => i.message.includes('highlight'))
    expect(issues).toEqual([
      {
        level: expectedContrastLevel(bad),
        message: expectedContrastMessage('Headline', bad, 'highlight'),
        slot: 'a',
      },
    ])
  })

  it('lets an explicit slot override change which colours its own contrast check uses', () => {
    const p = base()
    p.set.settings = { background: { kind: 'solid', color: '#ffffff' }, textColor: '#000000' }
    p.set.slots[0].overrides = { textColor: '#eeeeee' }
    const ratio = contrastAgainstBackground('#eeeeee', { kind: 'solid', color: '#ffffff' })
    expect(validateProject(p, always)).toContainEqual({
      level: expectedContrastLevel(ratio),
      message: expectedContrastMessage('Headline', ratio, 'background'),
      slot: 'a',
    })
  })

  it('checks an inverted slot against its alt colours, not the global ones', () => {
    const p = base()
    p.set.settings = {
      background: { kind: 'solid', color: '#ffffff' },
      textColor: '#000000',
      altColors: {
        background: { kind: 'solid', color: '#000000' },
        textColor: '#000000',
        eyebrowColor: null,
        highlights: ['#000000'],
      },
    }
    // Uninverted, black on white is fine.
    expect(validateProject(p, always).some((i) => i.message.startsWith('Headline contrast'))).toBe(false)

    p.set.slots[0].overrides = { inverted: true }
    const ratio = contrastRatio('#000000', '#000000')
    expect(validateProject(p, always)).toContainEqual({
      level: 'error',
      message: expectedContrastMessage('Headline', ratio, 'background'),
      slot: 'a',
    })
  })

  describe('accentBar', () => {
    it('accepts a hex colour on the global settings', () => {
      const p = base()
      p.set.settings = { accentBar: '#5d47e8' }
      expect(validateProject(p, always).some((i) => i.message.includes('accentBar'))).toBe(false)
    })

    it('flags a global accentBar that is not a hex colour', () => {
      const p = base()
      p.set.settings = { accentBar: 'purple' }
      expect(validateProject(p, always)).toContainEqual({
        level: 'error',
        message: 'accentBar is not a hex colour: purple',
      })
    })

    it('flags a slot override accentBar that is not a hex colour, with the slot id', () => {
      const p = base()
      p.set.slots[0].overrides = { accentBar: 'not-a-colour' }
      expect(validateProject(p, always)).toContainEqual({
        level: 'error',
        message: 'accentBar is not a hex colour: not-a-colour',
        slot: 'a',
      })
    })

    it('never flags accentBar left absent (null default)', () => {
      const p = base()
      expect(validateProject(p, always).some((i) => i.message.includes('accentBar'))).toBe(false)
    })
  })

  describe('subheadStyle', () => {
    it('accepts "plain" and "label"', () => {
      const p = base()
      p.set.settings = { subheadStyle: 'label', highlights: ['#ffe27a'] }
      expect(validateProject(p, always).some((i) => i.message.includes('subheadStyle'))).toBe(false)
    })

    it('flags an unknown subheadStyle on the global settings', () => {
      const p = base()
      // @ts-expect-error deliberately invalid, as a hand-edited project file could carry
      p.set.settings = { subheadStyle: 'boxed' }
      expect(validateProject(p, always)).toContainEqual({
        level: 'error',
        message: 'Unknown subheadStyle "boxed"',
      })
    })

    it('flags an unknown subheadStyle on a slot override, with the slot id', () => {
      const p = base()
      // @ts-expect-error deliberately invalid
      p.set.slots[0].overrides = { subheadStyle: 'boxed' }
      expect(validateProject(p, always)).toContainEqual({
        level: 'error',
        message: 'Unknown subheadStyle "boxed"',
        slot: 'a',
      })
    })

    it('warns when "label" has no highlights to draw the box in — the renderer falls back to plain', () => {
      const p = base()
      p.set.settings = { subheadStyle: 'label', highlights: [] }
      expect(validateProject(p, always)).toContainEqual({
        level: 'warn',
        message: 'subheadStyle "label" has no highlights to draw the box in; falls back to "plain"',
        slot: 'a',
      })
    })

    it('checks the label subhead against the label colour (highlights[0]), not the background', () => {
      const p = base()
      p.set.settings = {
        background: { kind: 'solid', color: '#ffffff' },
        textColor: '#767676', // ~4.54:1 opaque on white — passes background outright
        subheadStyle: 'label',
        highlights: ['#7a7a7a'], // close to textColor — should fail against the label, not the background
      }
      p.copies.en.a.subhead = 'Every euro gets a job.'
      const labelRatio = contrastRatio('#767676', '#7a7a7a')
      expect(labelRatio).toBeLessThan(AA_NORMAL_TEXT)
      expect(validateProject(p, always)).toContainEqual({
        level: expectedContrastLevel(labelRatio),
        message: expectedContrastMessage('Subhead', labelRatio, 'label'),
        slot: 'a',
      })
    })

    it('checks the label subhead fully opaque, not blended at the plain 0.72 alpha', () => {
      const p = base()
      const background = { kind: 'solid' as const, color: '#ffffff' }
      const textColor = '#767676'
      const highlightColor = '#7f7f7f'
      p.set.settings = { background, textColor, subheadStyle: 'label', highlights: [highlightColor] }
      p.copies.en.a.subhead = 'Every euro gets a job.'
      const opaque = contrastRatio(textColor, highlightColor)
      const issue = validateProject(p, always).find((i) => i.message.startsWith('Subhead contrast'))!
      expect(issue.message).toBe(expectedContrastMessage('Subhead', opaque, 'label'))
    })

    it('falls back to the plain background check when highlights is empty, even with subheadStyle "label"', () => {
      const p = base()
      const background = { kind: 'solid' as const, color: '#ffffff' }
      const textColor = '#767676'
      p.set.settings = { background, textColor, subheadStyle: 'label', highlights: [] }
      p.copies.en.a.subhead = 'Every euro gets a job.'
      const blended = contrastAgainstBackground(textColor, background, 0.72)
      expect(validateProject(p, always)).toContainEqual({
        level: expectedContrastLevel(blended),
        message: expectedContrastMessage('Subhead', blended, 'background'),
        slot: 'a',
      })
    })
  })
})
