import { createCanvas } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { composeDevices, renderScene, textFloor } from './scene'
import { frameAspect, getDevice } from '../presets/devices'
import { getLayout } from '../presets/layouts'
import { cutOutBackground, loupeCircle, pixelRect, turnedPixelRect } from './effects'
import { DEFAULT_SETTINGS } from '../store'
import { approvalHash } from '../project/hash'
import { effectRect, nodesPath, resolveNode, screensFor } from '../project/bridge'
import { validateProject } from '../project/validate'
import type { NodesFile, Project, SlotElement } from '../project/types'
import type { EffectElement, SceneElement, Screen, Settings } from '../types'

const sha = (data: Uint8ClampedArray) => createHash('sha256').update(data).digest('hex')

function stripes() {
  const shot = createCanvas(108, 240)
  const s = shot.getContext('2d')
  for (let i = 0; i < 12; i++) {
    s.fillStyle = `hsl(${i * 30}, 70%, 50%)`
    s.fillRect(0, i * 20, 108, 20)
  }
  return shot as unknown as CanvasImageSource
}

const OLD_ELEMENTS: SceneElement[] = [
  { id: 'c', shape: 'circle', color: '#ff00aa', x: 0.2, y: 0.8, width: 0.3, rotate: 0, layer: 'behind' },
  {
    id: 'b',
    shape: 'blob',
    color: '#00aaff',
    seed: 3,
    x: 0.8,
    y: 0.3,
    width: 0.3,
    rotate: 20,
    layer: 'front',
  },
]

function render(
  elements: SceneElement[],
  settings: Partial<Settings> = {},
  shot: CanvasImageSource = stripes(),
): Uint8ClampedArray {
  const ctx = createCanvas(400, 800).getContext('2d') as unknown as CanvasRenderingContext2D
  const screen: Screen = { id: 'a', headline: '', subhead: '', imageId: 'x', overrides: {}, elements }
  renderScene(
    ctx,
    400,
    800,
    screen,
    {
      ...DEFAULT_SETTINGS,
      background: { kind: 'gradient', from: '#123456', to: '#abcdef', angle: 135 },
      ...settings,
    },
    { self: shot, next: shot, prev: shot },
  )
  return ctx.getImageData(0, 0, 400, 800).data
}

/** Rendered with v2.12.0 (`71030c2`) before effects existed: the same scenes must stay byte-identical. */
const V2_12_0 = {
  'text-top': '9b97b6b73955b793bea56afe72891e87ad06c5a7a5fb356cd1900aa730856730',
  duo: '34be6e1f9eaf6a2e7cb9896519ac73f8b0e0d71ffc5121a9077fd6edc66177bd',
  hero: 'f722044b82f15618c4a27bad74197645f8bbd4a8c1535ab0b5a8aed564ae72f4',
}

const lift = (fields: Partial<EffectElement> = {}): EffectElement =>
  ({
    id: 'l',
    effect: 'lift',
    rect: { x: 0, y: 0.25, w: 1, h: 0.0833 },
    pad: 0,
    scale: 1.08,
    dim: 0.35,
    gray: 0,
    ...fields,
  }) as EffectElement

/** Pixels that differ between two renders, and their bounding box. */
function diff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let count = 0
  let top = Infinity
  let bottom = -Infinity
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
      count++
      const y = Math.floor(i / 4 / 400)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return { count, top, bottom }
}

describe('render: scenes without effects', () => {
  it('stay byte-identical to v2.12.0', () => {
    expect(sha(render(OLD_ELEMENTS, { layout: 'text-top', tilt: 0, positionId: 'center' }))).toBe(
      V2_12_0['text-top'],
    )
    expect(sha(render(OLD_ELEMENTS, { layout: 'duo', tilt: 6, positionId: 'duo' }))).toBe(V2_12_0.duo)
    expect(sha(render(OLD_ELEMENTS, { layout: 'hero', tilt: -4, positionId: 'center' }))).toBe(V2_12_0.hero)
  })
})

describe('render: effects', () => {
  const settings: Partial<Settings> = { layout: 'text-top', tilt: 0, positionId: 'center' }
  const plain = render(OLD_ELEMENTS, settings)

  it('each effect changes pixels, and redact/focus stay on the screen', () => {
    const effects: EffectElement[] = [
      lift(),
      {
        id: 'p',
        effect: 'loupe',
        rect: { x: 0.3, y: 0.5, w: 0.3, h: 0.05 },
        pad: 0,
        zoom: 2,
        place: 'over',
        ring: '#ffffff',
      },
      { id: 'f', effect: 'focus', rect: { x: 0, y: 0.5, w: 1, h: 0.0833 }, pad: 0, strength: 0.05, dim: 0 },
      {
        id: 'r',
        effect: 'redact',
        rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 },
        pad: 0,
        style: 'pixelate',
        strength: 0.1,
      },
      {
        id: 'r',
        effect: 'redact',
        rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 },
        pad: 0,
        style: 'blur',
        strength: 0.05,
      },
    ]
    for (const effect of effects)
      expect(diff(plain, render([...OLD_ELEMENTS, effect], settings)).count).toBeGreaterThan(50)
  })

  it('a redact changes only rows inside its target', () => {
    const shot = stripes()
    const redacted = render(
      [
        {
          id: 'r',
          effect: 'redact',
          rect: { x: 0, y: 0.5, w: 1, h: 0.25 },
          pad: 0,
          style: 'pixelate',
          strength: 0.1,
        },
      ],
      settings,
      shot,
    )
    const base = render([], settings, shot)
    const d = diff(base, redacted)
    expect(d.count).toBeGreaterThan(0)
    expect(d.top).toBeGreaterThan(300)
    expect(d.bottom).toBeLessThan(800)
  })

  it('is deterministic: two renders from fresh images are byte-identical', () => {
    const effects: SceneElement[] = [
      { id: 'f', effect: 'focus', rect: { x: 0, y: 0.5, w: 1, h: 0.1 }, pad: 0.01, strength: 0.02, dim: 0.2 },
      {
        id: 'r',
        effect: 'redact',
        rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
        pad: 0,
        style: 'blur',
        strength: 0.03,
      },
      lift({ gray: 1 }),
    ]
    expect(sha(render(effects, { ...settings, tilt: 5 }, stripes()))).toBe(
      sha(render(effects, { ...settings, tilt: 5 }, stripes())),
    )
  })

  it('draws nothing of an effect on a deviceless layout', () => {
    const s = { layout: 'text-only' as const }
    expect(sha(render([lift()], s))).toBe(sha(render([], s)))
  })

  it('a lift may reach past the device frame', () => {
    const device = getDevice(DEFAULT_SETTINGS.deviceId)
    const layout = getLayout('text-top')
    const [{ box }] = composeDevices(
      layout,
      'center',
      400,
      800,
      frameAspect(device),
      1,
      0,
      textFloor(layout, 800),
    )
    const wide = render([lift({ scale: 1.5, dim: 0 })], settings)
    const base = render([], settings)
    let outside = 0
    for (let y = 0; y < 800; y++)
      for (let x = 0; x < Math.floor(box.x); x++) {
        const i = (y * 400 + x) * 4
        if (wide[i] !== base[i]) outside++
      }
    expect(outside).toBeGreaterThan(0)
  })
})

describe('effect geometry', () => {
  it('pixelRect pads by a fraction of the width and stays inside the image', () => {
    expect(pixelRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, 0.05, 100, 200)).toEqual({
      x0: 5,
      y0: 15,
      x1: 35,
      y1: 45,
    })
    expect(pixelRect({ x: 0, y: 0, w: 1, h: 1 }, 0.1, 100, 200)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 200 })
  })

  it('a loupe beside its target clears it', () => {
    const target = { x: 100, y: 100, w: 50, h: 20 }
    const base = {
      id: 'p',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      pad: 0,
      effect: 'loupe' as const,
      zoom: 2,
      ring: '#fff',
    }
    const right = loupeCircle({ ...base, place: 'right' }, target, 400)
    expect(right.cx - right.d / 2).toBeGreaterThan(target.x + target.w)
    const above = loupeCircle({ ...base, place: 'above' }, target, 400)
    expect(above.cy + above.d / 2).toBeLessThan(target.y)
    expect(loupeCircle({ ...base, place: 'over', size: 0.25 }, target, 400).d).toBe(100)
  })
})

const NODES: NodesFile = {
  width: 1000,
  height: 2000,
  nodes: [
    { tag: 'balance', text: 'Kontostand', bounds: [100, 200, 900, 400] },
    { text: 'Sparen', desc: 'save', bounds: [0, 1000, 500, 1100] },
    { text: 'Sparen', bounds: [500, 1000, 1000, 1100] },
    { desc: 'menu', bounds: [0, 0, 100, 100] },
    { tag: 'twice', bounds: [0, 0, 10, 10] },
    { tag: 'twice', bounds: [0, 0, 20, 20] },
  ],
}

describe('resolveNode', () => {
  it('matches tag first, then text, then desc, as fractions of the capture', () => {
    expect(resolveNode(NODES, 'balance')).toEqual({ rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 } })
    expect(resolveNode(NODES, 'Kontostand')).toEqual({ rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 } })
    expect(resolveNode(NODES, 'menu')).toEqual({ rect: { x: 0, y: 0, w: 0.1, h: 0.05 } })
  })

  it('several names target the rectangle around all their nodes', () => {
    expect(resolveNode(NODES, ['balance', 'menu'])).toEqual({ rect: { x: 0, y: 0, w: 0.9, h: 0.2 } })
    expect(resolveNode(NODES, ['balance', 'nope'])).toEqual({
      error: expect.stringContaining('"nope" not found'),
    })
    expect(resolveNode(NODES, ['balance', 'twice'])).toEqual({ error: expect.stringContaining('matches 2') })
  })

  it('never guesses: several hits on one step or none at all are errors', () => {
    expect(resolveNode(NODES, 'twice')).toEqual({ error: expect.stringContaining('matches 2 nodes by tag') })
    expect(resolveNode(NODES, 'Sparen')).toEqual({ error: expect.stringContaining('by text') })
    expect(resolveNode(NODES, 'nope')).toEqual({ error: expect.stringContaining('not found') })
  })
})

function effectProject(elements: SlotElement[], kind: 'screen' | 'artwork' = 'screen'): Project {
  return {
    set: {
      version: 1,
      id: 'default',
      purpose: 'studio',
      targets: [{ id: 't', sizeId: 'studio-4x5', deviceId: 'pixel-9-pro', out: 'o/{n}.png' }],
      locales: [{ id: 'en' }],
      sources: 'shots/{locale}/{screen}.png',
      settings: {},
      slots: [
        kind === 'artwork'
          ? { id: 'a', kind, artwork: 'hero', overrides: {}, elements }
          : { id: 'a', kind, screen: 'home', overrides: {}, elements },
      ],
      approval: null,
    },
    copies: { en: { a: { headline: '', subhead: '' } } },
  }
}

const errorsOf = (project: Project, nodes: NodesFile | null = NODES) =>
  validateProject(
    project,
    () => true,
    () => true,
    undefined,
    undefined,
    undefined,
    null,
    () => nodes,
  )
    .filter((i) => i.level === 'error')
    .map((i) => i.message)

describe('bridge: effects', () => {
  it('puts a capture next to its screenshot', () => {
    expect(nodesPath(effectProject([]).set, 'de', 'home')).toBe('shots/de/home.nodes.json')
  })

  it('resolves a node into the scene and leaves an unresolved one out', () => {
    const project = effectProject([
      { id: 'l', effect: 'lift', node: 'balance' },
      { id: 'm', effect: 'loupe', node: 'missing' },
      { id: 'r', effect: 'redact', rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, pad: 0.01 },
    ])
    const [screen] = screensFor(project, 'en', () => NODES)
    expect(screen.elements).toEqual([
      {
        id: 'l',
        effect: 'lift',
        rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
        pad: 0,
        scale: 1.08,
        dim: 0.35,
        gray: 0,
      },
      {
        id: 'r',
        effect: 'redact',
        rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
        pad: 0.01,
        style: 'pixelate',
        strength: 0.03,
      },
    ])
    expect(screensFor(project, 'en')[0].elements).toHaveLength(1)
  })

  it('resolves a node list into the scene', () => {
    const [screen] = screensFor(
      effectProject([{ id: 'l', effect: 'lift', node: ['balance', 'menu'] }]),
      'en',
      () => NODES,
    )
    expect((screen.elements![0] as EffectElement).rect).toEqual({ x: 0, y: 0, w: 0.9, h: 0.2 })
  })

  it('needs exactly one of rect and node', () => {
    const both = { id: 'x', effect: 'focus' as const, node: 'balance', rect: { x: 0, y: 0, w: 1, h: 1 } }
    expect(effectRect(both, 'en', 'home', () => NODES)).toBeNull()
  })
})

describe('validate: effects', () => {
  it('accepts every effect kind with a good target', () => {
    expect(
      errorsOf(
        effectProject([
          { id: 'l', effect: 'lift', node: 'balance', pad: 0.01, scale: 1.1, dim: 0.4, gray: 0.5 },
          { id: 'p', effect: 'loupe', node: 'menu', zoom: 2.5, size: 0.3, place: 'right', ring: '#ff0000' },
          { id: 'f', effect: 'focus', rect: { x: 0, y: 0.5, w: 1, h: 0.1 }, strength: 0.02, dim: 0.1 },
          { id: 'r', effect: 'redact', rect: { x: 0, y: 0, w: 0.5, h: 0.1 }, style: 'blur', strength: 0.05 },
        ]),
      ),
    ).toEqual([])
  })

  it('reports the first entry of a node list that does not resolve', () => {
    expect(errorsOf(effectProject([{ id: 'a', effect: 'lift', node: ['balance', 'gone', 'menu'] }]))).toEqual(
      ['Effect a: node "gone" not found by tag, text or desc'],
    )
    expect(errorsOf(effectProject([{ id: 'a', effect: 'lift', node: ['balance', 'menu'] }]))).toEqual([])
  })

  it('reports a missing nodes file, an unknown and an ambiguous node', () => {
    const project = effectProject([
      { id: 'a', effect: 'lift', node: 'nope' },
      { id: 'b', effect: 'lift', node: 'Sparen' },
    ])
    expect(errorsOf(project, null)).toEqual(['Nodes file missing: shots/en/home.nodes.json'])
    const errors = errorsOf(project)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('Effect a: node "nope" not found')
    expect(errors[1]).toContain('Effect b: node "Sparen" matches 2 nodes by text')
    expect(errorsOf(project, { width: 0 } as unknown as NodesFile)[0]).toContain(
      'needs positive width and height',
    )
  })

  it('rejects a bad target, a field of another effect and values out of range', () => {
    const errors = errorsOf(
      effectProject([
        { id: 'a', effect: 'lift' },
        { id: 'b', effect: 'lift', rect: { x: 0.8, y: 0, w: 0.5, h: 0.1 } },
        { id: 'c', effect: 'loupe', node: 'balance', rect: { x: 0, y: 0, w: 0.1, h: 0.1 } },
        { id: 'd', effect: 'focus', node: 'balance', zoom: 2 } as unknown as SlotElement,
        {
          id: 'e',
          effect: 'redact',
          node: 'balance',
          style: 'smudge',
          strength: 1,
        } as unknown as SlotElement,
        { id: 'f', effect: 'loupe', node: 'balance', ring: 'red', pad: 0.5 },
        { id: 'g', effect: 'shine', node: 'balance' } as unknown as SlotElement,
        { id: 'h', effect: 'lift', node: ['balance'] },
        { id: 'i', effect: 'lift', node: ['balance', ''] },
      ]),
    )
    expect(errors).toEqual([
      'Effect a: needs exactly one of rect or node',
      'Effect b: rect must lie inside the screenshot (fractions 0..1)',
      'Effect c: needs exactly one of rect or node',
      'Effect d: field zoom does not apply to a focus',
      'Effect e: style must be one of pixelate, blur',
      'Effect e: strength 1 outside 0.005–0.1',
      'Effect f: pad 0.5 outside 0–0.2',
      'Effect f: ring is not a hex colour: red',
      'Effect g: unknown effect "shine"; one of lift, loupe, focus, redact',
      'Effect h: node must be a non-empty string or an array of at least two of them',
      'Effect i: node must be a non-empty string or an array of at least two of them',
    ])
  })

  it('an effect needs a screen slot, and warns where no device screen is drawn', () => {
    expect(
      errorsOf(effectProject([{ id: 'l', effect: 'lift', rect: { x: 0, y: 0, w: 1, h: 0.1 } }], 'artwork')),
    ).toContain('An effect needs a screen slot; an artwork slot has no screenshot')
    const project = effectProject([{ id: 'l', effect: 'lift', rect: { x: 0, y: 0, w: 1, h: 0.1 } }])
    project.set.settings.layout = 'text-only'
    const warnings = validateProject(project, () => true).filter((i) => i.level === 'warn')
    expect(warnings.map((w) => w.message)).toContain(
      'Layout "text-only" draws no device screen; effects unused',
    )
  })
})

describe('approvalHash: effects', () => {
  /** v2.12.0 (`71030c2`) hashed this set to exactly this value: effects must not move it. */
  const OLD_SET = {
    set: {
      version: 1,
      id: 'default',
      targets: [
        { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'o/{storeLocale}/{n}.png' },
      ],
      locales: [
        { id: 'en', store: { appstore: 'en-US' } },
        { id: 'de', store: { appstore: 'de-DE' } },
      ],
      sources: 's/{locale}/{screen}.png',
      settings: { layout: 'duo' },
      slots: [
        {
          id: 'a',
          kind: 'screen',
          screen: 'shot',
          pair: 'other',
          overrides: {},
          elements: [
            { id: 'st', artwork: 'coin', x: 0.5, y: 0.5, width: 0.2 },
            { id: 'c', chip: true, x: 0.3, y: 0.3, width: 0.4 },
          ],
        },
        { id: 'b', kind: 'artwork', artwork: 'hero', overrides: {} },
      ],
      approval: { hash: 'old', at: 'y' },
    },
    copies: {
      en: { a: { headline: 'Hi', subhead: '', chips: { c: '+3 €' } }, b: { headline: 'B', subhead: '' } },
      de: { a: { headline: 'Hallo', subhead: '', chips: { c: '+3 €' } } },
    },
  } as unknown as Project
  const enc = (s: string) => async (l: string, n: string) => new TextEncoder().encode(`${s}:${l}/${n}`)

  it('keeps the v2.12.0 hash of a set without effects, with or without a nodes reader', async () => {
    const want = '7fe735b9ea180b4f6ce85fde47a29bc35cd2ca1a5543a36aff8b252a213187bc'
    expect(await approvalHash(OLD_SET, enc('img'), enc('art'))).toBe(want)
    expect(await approvalHash(OLD_SET, enc('img'), enc('art'), enc('nodes'))).toBe(want)
  })

  it('covers the effect fields, and the nodes bytes once an effect aims at a node', async () => {
    const withRect = effectProject([{ id: 'l', effect: 'lift', rect: { x: 0, y: 0, w: 1, h: 0.1 } }])
    const changed = effectProject([{ id: 'l', effect: 'lift', rect: { x: 0, y: 0, w: 1, h: 0.1 }, dim: 0.5 }])
    expect(await approvalHash(withRect, enc('img'))).not.toBe(await approvalHash(changed, enc('img')))
    expect(await approvalHash(withRect, enc('img'), undefined, enc('n1'))).toBe(
      await approvalHash(withRect, enc('img'), undefined, enc('n2')),
    )
    const withNode = effectProject([{ id: 'l', effect: 'lift', node: 'balance' }])
    expect(await approvalHash(withNode, enc('img'), undefined, enc('n1'))).not.toBe(
      await approvalHash(withNode, enc('img'), undefined, enc('n2')),
    )
  })
})

describe('lift: turned, cut out, grouped, on another device (v3.1.0)', () => {
  const settings: Partial<Settings> = { layout: 'text-top', tilt: 0, positionId: 'center' }
  const card = { rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.2 }, scale: 1.2 }

  it('a turned or cut-out lift draws differently from the plain one, and stays deterministic', () => {
    const plain = render([lift(card)], settings)
    const turned = render([lift({ ...card, angle: 8 })], settings)
    const cut = render([lift({ ...card, cutout: true })], settings)
    expect(diff(plain, turned).count).toBeGreaterThan(0)
    expect(diff(plain, cut).count).toBeGreaterThan(0)
    expect(sha(render([lift({ ...card, angle: 8 })], settings))).toBe(sha(turned))
  })

  it('a group raises its members as one stack, not one by one', () => {
    const a = lift({ id: 'a', rect: { x: 0.1, y: 0.3, w: 0.5, h: 0.2 }, scale: 1.3, angle: -3 })
    const b = lift({ id: 'b', rect: { x: 0.4, y: 0.4, w: 0.5, h: 0.2 }, scale: 1.3, angle: 4 })
    const single = render([a, b], settings)
    const stacked = render(
      [{ ...a, group: 'g' } as EffectElement, { ...b, group: 'g' } as EffectElement],
      settings,
    )
    expect(diff(single, stacked).count).toBeGreaterThan(0)
  })

  it('an effect on the pair changes the picture, and differs from the same effect on the own screen', () => {
    const duo = { layout: 'text-top' as const, tilt: 0, positionId: 'duo' }
    const base = render([], duo)
    const own = render([lift(card)], duo)
    const pair = render([lift({ ...card, device: 'next' })], duo)
    expect(diff(base, pair).count).toBeGreaterThan(0)
    expect(diff(own, pair).count).toBeGreaterThan(0)
  })

  it('turnedPixelRect equals pixelRect unturned and swaps the sides at 90 degrees', () => {
    const rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.25 }
    expect(turnedPixelRect(rect, 0, 0, 100, 100)).toEqual(pixelRect(rect, 0, 100, 100))
    const r = turnedPixelRect(rect, 0, 90, 100, 100)
    expect(Math.abs(r.x1 - r.x0 - 25)).toBeLessThanOrEqual(1)
    expect(Math.abs(r.y1 - r.y0 - 50)).toBeLessThanOrEqual(1)
  })

  it('cutOutBackground clears what touches the edge and keeps a matching hole inside the target', () => {
    const w = 10
    const h = 10
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let y = 3; y < 7; y++)
      for (let x = 3; x < 7; x++) {
        const i = (y * w + x) * 4
        data[i] = 20
        data[i + 1] = 40
        data[i + 2] = 200
      }
    const hole = (5 * w + 5) * 4
    data[hole] = data[hole + 1] = data[hole + 2] = 255
    cutOutBackground({ data, w, h })
    expect(data[3]).toBe(0)
    expect(data[(4 * w + 4) * 4 + 3]).toBe(255)
    expect(data[hole + 3]).toBe(255)
  })
})

describe('bridge and validate: lift fields of v3.1.0', () => {
  const turned = {
    id: 'l',
    effect: 'lift' as const,
    rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
    angle: 5,
    cutout: true,
    group: 'cards',
    mirrorRtl: true,
    device: 'next' as const,
  }

  it('mirrors the rect only in a right-to-left locale, and passes the new fields on', () => {
    const project = effectProject([turned])
    project.set.locales = [{ id: 'en' }, { id: 'ar' }]
    const [en] = screensFor(project, 'en')
    const [ar] = screensFor(project, 'ar')
    expect(en.elements?.[0]).toMatchObject({
      rect: { x: 0.1 },
      angle: 5,
      cutout: true,
      group: 'cards',
      device: 'next',
    })
    const mirrored = ar.elements?.[0] as EffectElement
    expect(mirrored.rect.x).toBeCloseTo(0.6)
  })

  it('leaves the new fields out of a scene that does not set them', () => {
    const [screen] = screensFor(effectProject([{ id: 'l', effect: 'lift', rect: turned.rect }]), 'en')
    expect(Object.keys(screen.elements?.[0] ?? {})).not.toContain('angle')
    expect(Object.keys(screen.elements?.[0] ?? {})).not.toContain('device')
  })

  it('accepts good values and rejects bad ones', () => {
    expect(errorsOf(effectProject([turned]))).toEqual([])
    const errors = errorsOf(
      effectProject([
        { ...turned, id: 'a', angle: 60 },
        { ...turned, id: 'b', cutout: 'yes' } as unknown as SlotElement,
        { ...turned, id: 'c', group: ' ' },
        { ...turned, id: 'd', device: 'side' } as unknown as SlotElement,
        { id: 'e', effect: 'lift', node: 'balance', device: 'next' },
      ]),
    )
    expect(errors).toEqual([
      'Effect a: angle 60 outside -45–45',
      'Effect b: cutout must be true or false',
      'Effect c: group must be a non-empty string',
      'Effect d: device must be one of self, next, prev',
      "Effect e: a node is looked up in the slot's own capture; give the other device a rect",
    ])
  })
})
