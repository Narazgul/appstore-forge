import { describe, expect, it } from 'vitest'
import { approvalHash } from './hash'
import { backgroundImageSrcs } from './types'
import type { Project } from './types'
import { validateProject } from './validate'
import { backgroundProblems } from './validateBackground'

const project = (): Project => ({
  set: {
    version: 1,
    id: 'probe',
    purpose: 'studio',
    targets: [{ id: 'web', sizeId: 'studio-4x5', deviceId: 'pixel-9-pro', out: 'out/{n}.png' }],
    locales: [{ id: 'en' }],
    sources: 's/{locale}/{screen}.png',
    settings: {},
    slots: [
      { id: 'a', kind: 'screen', screen: 'shot', overrides: {} },
      { id: 'b', kind: 'screen', screen: 'shot', overrides: {} },
    ],
    approval: null,
  },
  copies: { en: { a: { headline: 'Hi', subhead: '' }, b: { headline: 'Ho', subhead: '' } } },
})
const bytes = (s: string) => async () => new TextEncoder().encode(s)
const bg = (src: string) => ({ kind: 'solid' as const, color: '#222222', image: { src } })

describe('backgroundImageSrcs', () => {
  it('names each image of the set, its contrast pair and every slot once', () => {
    const p = project()
    p.set.settings.background = bg('h/a.jpg')
    p.set.slots[0].overrides.background = bg('h/b.jpg')
    p.set.slots[1].overrides.background = bg('h/a.jpg')
    p.set.slots[1].overrides.altColors = {
      background: bg('h/c.jpg'),
      textColor: '#fff',
      eyebrowColor: null,
      highlights: [],
    }
    expect(backgroundImageSrcs(p.set)).toEqual(['h/a.jpg', 'h/b.jpg', 'h/c.jpg'])
  })
})

describe('approvalHash with background images', () => {
  it('a set without one hashes alike whether or not the image reader is passed', async () => {
    const p = project()
    p.set.settings.background = { kind: 'solid', color: '#ffffff' }
    const reader = async () => {
      throw new Error('never read')
    }
    expect(await approvalHash(p, bytes('img'), undefined, undefined, reader)).toBe(
      await approvalHash(p, bytes('img')),
    )
  })

  it('counts the image bytes and the finish fields', async () => {
    const p = project()
    p.set.settings.background = bg('h/a.jpg')
    const base = await approvalHash(p, bytes('img'), undefined, undefined, bytes('one'))
    expect(await approvalHash(p, bytes('img'), undefined, undefined, bytes('two'))).not.toBe(base)
    p.set.settings.background = { ...bg('h/a.jpg'), finish: [{ kind: 'grain', seed: 2 }] }
    const seeded = await approvalHash(p, bytes('img'), undefined, undefined, bytes('one'))
    expect(seeded).not.toBe(base)
    p.set.settings.background = { ...bg('h/a.jpg'), finish: [{ kind: 'grain', seed: 3 }] }
    expect(await approvalHash(p, bytes('img'), undefined, undefined, bytes('one'))).not.toBe(seeded)
  })
})

describe('backgroundProblems', () => {
  const exists = (src: string) => src !== 'h/gone.jpg'

  it('accepts a full, valid background', () => {
    expect(
      backgroundProblems(
        {
          kind: 'solid',
          color: '#333',
          image: { src: 'h/a.jpg', focusX: 0.2, focusY: 1, zoom: 1.5, blur: 0.01, brightness: 0.8 },
          finish: [
            { kind: 'grain', amount: 0.1, mono: false, seed: 4 },
            { kind: 'riso', inks: ['#ff6c2f', '#3255a4'], offset: 0.01 },
            { kind: 'reeded', direction: 'horizontal' },
          ],
        },
        exists,
      ),
    ).toEqual([])
  })

  it('names what is wrong', () => {
    const problems = backgroundProblems(
      {
        kind: 'solid',
        color: '#333',
        image: { src: '../outside.jpg', zoom: 0.5, tint: 1 },
        finish: [
          { kind: 'sparkle' },
          { kind: 'grain', amount: 2, seed: 1.5 },
          { kind: 'riso', inks: ['#fff'] },
        ],
      },
      exists,
    )
    expect(problems).toEqual([
      'background.image.src must be a path inside the repo: ../outside.jpg',
      'background.image: zoom 0.5 outside 1–4',
      'background.image: field tint does not apply',
      'background.finish[0]: unknown kind "sparkle"; one of grain, motion, halftone, newsprint, dither, riso, duotone, reeded',
      'background.finish[1] (grain): amount 2 outside 0–0.5',
      'background.finish[1] (grain): seed must be an integer',
      'background.finish[2] (riso): inks must be two hex colours',
    ])
  })

  it('reports a missing image file through validateProject, on the slot that names it', () => {
    const p = project()
    p.set.slots[1].overrides.background = bg('h/gone.jpg')
    const issues = validateProject(
      p,
      () => true,
      undefined,
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      exists,
    )
    expect(issues).toContainEqual({
      level: 'error',
      message: 'Background image missing: h/gone.jpg',
      slot: 'b',
    })
  })
})
