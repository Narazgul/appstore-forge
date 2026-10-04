import { createCanvas } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerFonts } from '../../cli/fonts'
import { DEFAULT_SETTINGS, projectAfterSlotElements } from '../store'
import { approvalHash } from '../project/hash'
import { markTarget, screensFor } from '../project/bridge'
import { inputProblems, TOOLS } from '../project/tools'
import { hasChipText, usesNodes } from '../project/types'
import type { NodesFile, Project, SlotElement } from '../project/types'
import { validateProject } from '../project/validate'
import { DEVICES, frameAspect, getDevice } from '../presets/devices'
import type { ArrowMark, MarkElement, SceneElement, Screen, Settings } from '../types'
import { deviceScreen } from './frames'
import {
  arrowPath,
  drawMarks,
  edgeToward,
  markColor,
  readableOn,
  screenFrame,
  sidePoint,
  type Frame,
} from './marks'
import { renderScene } from './scene'

const sha = (data: Uint8ClampedArray) => createHash('sha256').update(data).digest('hex')

beforeAll(() => registerFonts())

function stripes() {
  const shot = createCanvas(108, 240)
  const s = shot.getContext('2d')
  for (let i = 0; i < 12; i++) {
    s.fillStyle = `hsl(${i * 30}, 70%, 50%)`
    s.fillRect(0, i * 20, 108, 20)
  }
  return shot as unknown as CanvasImageSource
}

const BACKGROUND = { kind: 'gradient', from: '#123456', to: '#abcdef', angle: 135 } as const

function render(
  w: number,
  h: number,
  settings: Partial<Settings>,
  elements: SceneElement[] = [],
  extraIds?: string[],
  shot: CanvasImageSource = stripes(),
) {
  const ctx = createCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D
  const screen: Screen = {
    id: 'a',
    headline: 'Plan *every* euro',
    subhead: 'Before the month starts',
    imageId: 'x',
    overrides: {},
    elements,
    extraIds,
    lang: 'en',
  }
  renderScene(
    ctx,
    w,
    h,
    screen,
    { ...DEFAULT_SETTINGS, background: BACKGROUND, ...settings },
    { self: shot, next: shot, prev: shot, extra: extraIds?.map(() => shot) },
  )
  return ctx.getImageData(0, 0, w, h).data
}

describe('renderScene without marks or depth', () => {
  /** Rendered with v2.13.0 (`9c1beb2`): a scene using none of the new fields stays byte-identical. */
  const V2_13_0: [string, number, number, Partial<Settings>, SceneElement[], string[]?, string?][] = [
    [
      'text-top',
      400,
      800,
      { deviceId: 'iphone-17-pro', positionId: 'center' },
      [
        {
          id: 'l',
          effect: 'lift',
          rect: { x: 0, y: 0.25, w: 1, h: 0.08 },
          pad: 0,
          scale: 1.08,
          dim: 0.35,
          gray: 0,
        },
      ],
      undefined,
      '2ed8b39cf54f0b6932642a4b91b9dcce62f1dc0a39b30b0c3a046017c853ae18',
    ],
    [
      'hero',
      400,
      800,
      { deviceId: 'pixel-9-pro', positionId: 'trio', tilt: 5, deviceShadow: 'hard' },
      [
        {
          id: 'c',
          text: '+312 €',
          size: 0.03,
          x: 0.5,
          y: 0.9,
          width: 0.6,
          rotate: -4,
          layer: 'front',
          shadow: true,
        },
      ],
      undefined,
      '72850687f101beda588e16462060214bafc1cf76c6f4356d610474926ee698eb',
    ],
    [
      'text-bottom',
      400,
      800,
      { deviceId: 'galaxy-s25', positionId: 'duo-tilt', frameColorId: 'silver' },
      [],
      undefined,
      '4d0b8bcb3d1b063f4d808af0c40cf039739d869d3627d975108f2ee6f297bbbe',
    ],
    [
      'mosaic',
      400,
      800,
      { deviceId: 'pixel-8a' },
      [],
      ['e1', 'e2', 'e3'],
      '8dc826f5f202c69407bf52745f579a662bc47181a4fed7262d2a5c3c6b8ba9c5',
    ],
    [
      'text-top',
      400,
      800,
      { deviceId: 'none', positionId: 'wings', backdropColor: '#ffffff' },
      [],
      undefined,
      'a00b51a76ed2cc6cff1f9aef2c23b694c34227c0dcd1b884af3e2ac1a6d2bc80',
    ],
    [
      'landscape-center',
      480,
      270,
      { deviceId: 'ipad-13' },
      [],
      undefined,
      'b8ff2730750286148964edde8626315b3b919ca21a23dba691635856e9028254',
    ],
  ]

  it.each(V2_13_0)('%s %ix%i draws exactly as v2.13.0', (layout, w, h, settings, elements, extra, want) => {
    expect(sha(render(w, h, { layout: layout as Settings['layout'], ...settings }, elements, extra))).toBe(
      want,
    )
  })
})

const NODES: NodesFile = {
  width: 1080,
  height: 2400,
  nodes: [
    { text: 'Rent', bounds: [200, 600, 800, 660] },
    { text: '$1,000', bounds: [860, 600, 1000, 660] },
    { text: '$8,430', bounds: [90, 300, 340, 400] },
    { text: '$0', bounds: [900, 900, 1000, 960] },
    { text: '$0', bounds: [900, 1100, 1000, 1160] },
  ],
}

function markProject(elements: SlotElement[], kind: 'screen' | 'artwork' = 'screen'): Project {
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
    copies: { en: { a: { headline: 'Hi', subhead: '', chips: { cap: 'Free money' } } } },
  }
}

const issuesOf = (project: Project, nodes: NodesFile | null = NODES) =>
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
const errorsOf = (project: Project, nodes: NodesFile | null = NODES) =>
  issuesOf(project, nodes)
    .filter((i) => i.level === 'error')
    .map((i) => i.message)

describe('bridge: marks', () => {
  it('resolves screen targets like effects, tile points and boxes, and the text block', () => {
    const [screen] = screensFor(
      markProject([
        { id: 's', mark: 'step', n: 1, node: ['Rent', '$1,000'] },
        { id: 'a', mark: 'arrow', from: { textBlock: true, side: 'bottom' }, to: { node: '$8,430' } },
        { id: 'h', mark: 'highlight', at: { x: 0.5, y: 0.2, w: 0.3, h: 0.05 } },
        { id: 'cap', mark: 'label', rect: { x: 0, y: 0, w: 0.5, h: 0.1 }, pad: 0.01 },
      ]),
      'en',
      () => NODES,
    )
    const marks = screen.elements as MarkElement[]
    expect(marks.map((m) => m.mark)).toEqual(['step', 'arrow', 'highlight', 'label'])
    expect(marks[0]).toMatchObject({ n: '1', size: 0.062, at: { on: 'screen', pad: 0 } })
    const rect = (marks[0] as { at: { rect: { x: number; w: number; y: number } } }).at.rect
    expect(rect.x).toBeCloseTo(200 / 1080, 10)
    expect(rect.x + rect.w).toBeCloseTo(1000 / 1080, 10)
    expect(marks[1]).toMatchObject({
      from: { on: 'text', side: 'bottom' },
      to: { on: 'screen' },
      curve: 0.25,
      stroke: 0.009,
    })
    expect(marks[2]).toMatchObject({ at: { on: 'tile', x: 0.5, y: 0.2, w: 0.3, h: 0.05 }, opacity: 0.85 })
    expect(marks[3]).toMatchObject({ caption: 'Free money', at: { on: 'screen', pad: 0.01 }, size: 0.024 })
  })

  it('leaves out a mark whose screen target does not resolve, never guessing a place', () => {
    const elements: SlotElement[] = [
      { id: 's', mark: 'step', n: 1, node: 'missing' },
      { id: 'a', mark: 'arrow', from: { at: { x: 0.1, y: 0.1 } }, to: { node: '$0' } },
      { id: 'o', mark: 'outline', at: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } },
    ]
    expect(screensFor(markProject(elements), 'en', () => NODES)[0].elements!.map((e) => e.id)).toEqual(['o'])
    expect(screensFor(markProject(elements), 'en')[0].elements!.map((e) => e.id)).toEqual(['o'])
  })

  it('keeps tile marks on an artwork slot, which has no screen to aim at', () => {
    const [screen] = screensFor(
      markProject(
        [
          { id: 's', mark: 'step', n: 'A', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
          { id: 't', mark: 'step', n: 'B', at: { x: 0.5, y: 0.5 } },
        ],
        'artwork',
      ),
      'en',
    )
    expect(screen.elements!.map((e) => e.id)).toEqual(['t'])
  })

  it('takes a target without side when absent', () => {
    expect(markTarget({ at: { x: 0.2, y: 0.3 } }, 'en', 'home', undefined)).toEqual({
      on: 'tile',
      x: 0.2,
      y: 0.3,
      w: 0,
      h: 0,
    })
  })
})

describe('validateProject: marks', () => {
  it('accepts a full set of marks', () => {
    expect(
      errorsOf(
        markProject([
          { id: 's', mark: 'step', n: 1, node: ['Rent', '$1,000'], size: 0.08, color: '#ff0000' },
          {
            id: 'a',
            mark: 'arrow',
            from: { textBlock: true },
            to: { node: '$8,430', side: 'left' },
            curve: -0.4,
          },
          { id: 'h', mark: 'highlight', node: 'Rent', opacity: 0.6 },
          { id: 'o', mark: 'outline', rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 }, stroke: 0.01, pad: 0.02 },
          { id: 'cap', mark: 'label', at: { x: 0.5, y: 0.9 }, textColor: '#000' },
        ]),
      ),
    ).toEqual([])
  })

  it('rejects bad targets, foreign fields and values out of range', () => {
    expect(
      errorsOf(
        markProject([
          { id: 'a', mark: 'step', n: 1 },
          { id: 'b', mark: 'step', n: 1, rect: { x: 0.8, y: 0, w: 0.5, h: 0.1 } },
          { id: 'c', mark: 'step', n: 'ABCD', at: { x: 0.5, y: 0.5 }, textBlock: true },
          {
            id: 'd',
            mark: 'arrow',
            from: { at: { x: 0.1 } },
            to: { node: ['Rent'] },
          } as unknown as SlotElement,
          { id: 'e', mark: 'highlight', at: { x: 0.5, y: 0.5 }, pad: 0.1, opacity: 2 },
          { id: 'f', mark: 'outline', node: 'Rent', side: 'up', zoom: 2 } as unknown as SlotElement,
          { id: 'g', mark: 'circle', at: { x: 0, y: 0 } } as unknown as SlotElement,
          { id: 'h', mark: 'label', node: 'Rent', color: 'red' },
          { id: 'i', mark: 'step', effect: 'lift', n: 2, node: 'Rent' } as unknown as SlotElement,
        ]),
      ),
    ).toEqual([
      'Mark a: target needs exactly one of rect, node, at or textBlock',
      'Mark b: target rect must lie inside the screenshot (fractions 0..1)',
      'Mark c: target needs exactly one of rect, node, at or textBlock',
      'Mark c: n must be a whole number 0–999 or up to three characters',
      'Mark d: from at needs finite numbers x and y',
      'Mark d: to node must be a non-empty string or an array of at least two of them',
      'Mark e: target pad only applies to rect or node',
      'Mark e: opacity 2 outside 0.1–1',
      'Mark f: target side must be one of center, left, right, top, bottom',
      'Mark f: field zoom does not apply to a outline',
      'Mark g: unknown mark "circle"; one of step, arrow, highlight, outline, label',
      'Mark h: color is not a hex colour: red',
      'Element i must be exactly one of artwork, shape, chip, effect or mark',
      'Mark i: field effect does not apply to a step',
      'Label text missing: h',
    ])
  })

  it('looks every node up in the capture and fails instead of guessing', () => {
    const project = markProject([
      { id: 's', mark: 'step', n: 1, node: 'nope' },
      { id: 'a', mark: 'arrow', from: { textBlock: true }, to: { node: '$0' } },
    ])
    expect(errorsOf(project)).toEqual([
      'Mark s: node "nope" not found by tag, text or desc',
      'Mark a: node "$0" matches 2 nodes by text',
    ])
    expect(errorsOf(project, null)).toEqual(['Nodes file missing: shots/en/home.nodes.json'])
  })

  it('needs a screen slot for a screen target and warns where none is drawn', () => {
    const onScreen: SlotElement[] = [{ id: 's', mark: 'step', n: 1, rect: { x: 0, y: 0, w: 1, h: 0.1 } }]
    expect(errorsOf(markProject(onScreen, 'artwork'))).toContain(
      'A mark on the screen needs a screen slot; an artwork slot has no screenshot',
    )
    expect(
      errorsOf(markProject([{ id: 't', mark: 'step', n: 1, at: { x: 0.5, y: 0.5 } }], 'artwork')),
    ).toEqual([])
    const project = markProject([...onScreen, { id: 'x', mark: 'outline', textBlock: true }])
    project.set.settings.layout = 'feature-wall'
    project.copies.en.a.list = ['a', 'b']
    const warnings = issuesOf(project)
      .filter((i) => i.level === 'warn')
      .map((i) => i.message)
    expect(warnings).toContain('Layout "feature-wall" draws no device screen; marks on the screen unused')
    project.set.settings.layout = 'centered'
    expect(
      issuesOf(project)
        .filter((i) => i.level === 'warn')
        .map((i) => i.message),
    ).toContain('Layout "centered" has no text block; marks on it unused')
  })

  it('takes a label text from the chips copy, one line', () => {
    const project = markProject([{ id: 'cap', mark: 'label', at: { x: 0.5, y: 0.5 } }])
    expect(errorsOf(project)).toEqual([])
    project.copies.en.a.chips = { cap: 'two\nlines' }
    expect(errorsOf(project)).toEqual(['Label text must be one line: cap'])
  })

  it('checks the frame and depth settings, set-wide and per slot', () => {
    const project = markProject([])
    project.set.settings = { browserUrl: 'getalife.app', backBlur: true, deviceFade: 'dark' }
    expect(errorsOf(project)).toEqual([])
    project.set.settings = { browserUrl: 'a\nb', backBlur: 'yes', deviceFade: 'fog' } as never
    project.set.slots[0].overrides = { deviceFade: 'up' } as never
    expect(errorsOf(project)).toEqual([
      'browserUrl must be one line of text',
      'backBlur must be true or false',
      'deviceFade must be one of dark, background',
      'deviceFade must be one of dark, background',
    ])
  })
})

describe('marks in the set and its hash', () => {
  const enc = (s: string) => async (l: string, n: string) => new TextEncoder().encode(`${s}:${l}/${n}`)
  /** v2.13.0 (`9c1beb2`) hashed this set to exactly this value. */
  const OLD = (): Project =>
    ({
      set: {
        version: 1,
        id: 'default',
        targets: [
          { id: 'play', sizeId: 'play-phone', deviceId: 'pixel-9-pro', out: 'o/{storeLocale}/{n}.png' },
        ],
        locales: [
          { id: 'en', store: { play: 'en-US' } },
          { id: 'de', store: { play: 'de-DE' } },
        ],
        sources: 's/{locale}/{screen}.png',
        settings: { layout: 'duo', positionId: 'duo' },
        slots: [
          {
            id: 'a',
            kind: 'screen',
            screen: 'shot',
            overrides: {},
            elements: [
              { id: 'l', effect: 'lift', node: 'balance' },
              { id: 'c', chip: true, x: 0.3, y: 0.3, width: 0.4 },
            ],
          },
          { id: 'b', kind: 'screen', screen: 'other', overrides: { tilt: 3 } },
        ],
        approval: null,
      },
      copies: {
        en: { a: { headline: 'Hi', subhead: '', chips: { c: '+3' } }, b: { headline: 'B', subhead: '' } },
        de: { a: { headline: 'Hallo', subhead: '', chips: { c: '+3' } }, b: { headline: 'B', subhead: '' } },
      },
    }) as unknown as Project

  it('keeps the v2.13.0 hash of a set without marks', async () => {
    expect(await approvalHash(OLD(), enc('img'), enc('art'), enc('nodes'))).toBe(
      'c2303391ea5e6e5f2a2ec947a6bc8d813ac4e25dce6c8453314223f78ed91545',
    )
  })

  it('covers mark fields, frame settings and the nodes bytes a mark aims through', async () => {
    const base = OLD()
    base.set.slots[1].elements = [{ id: 'o', mark: 'outline', at: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } }]
    const moved = OLD()
    moved.set.slots[1].elements = [{ id: 'o', mark: 'outline', at: { x: 0.5, y: 0.6, w: 0.2, h: 0.1 } }]
    const hash = (p: Project, nodes = 'n1') => approvalHash(p, enc('img'), enc('art'), enc(nodes))
    expect(await hash(base)).not.toBe(await hash(moved))
    expect(await hash(base, 'n1')).toBe(await hash(base, 'n1'))

    const viaNode = OLD()
    viaNode.set.slots[1].elements = [
      { id: 'a', mark: 'arrow', from: { textBlock: true }, to: { node: 'balance' } },
    ]
    const noEffect = OLD()
    noEffect.set.slots[0].elements = [{ id: 'c', chip: true, x: 0.3, y: 0.3, width: 0.4 }]
    noEffect.set.slots[1].elements = viaNode.set.slots[1].elements
    expect(await hash(noEffect, 'n1')).not.toBe(await hash(noEffect, 'n2'))

    const fade = OLD()
    fade.set.settings.deviceFade = 'dark'
    expect(await hash(fade)).not.toBe(await hash(OLD()))
  })

  it('knows which elements use nodes and which carry chip text', () => {
    expect(usesNodes({ id: 'a', mark: 'arrow', from: { at: { x: 0, y: 0 } }, to: { node: 'x' } })).toBe(true)
    expect(usesNodes({ id: 's', mark: 'step', n: 1, rect: { x: 0, y: 0, w: 1, h: 1 } })).toBe(false)
    expect(usesNodes({ id: 'l', effect: 'lift', node: 'x' })).toBe(true)
    expect(hasChipText({ id: 'l', mark: 'label', at: { x: 0, y: 0 } })).toBe(true)
    expect(hasChipText({ id: 'o', mark: 'outline', at: { x: 0, y: 0 } })).toBe(false)
  })

  it("keeps a label's text when the elements change, and drops it with the label", () => {
    const project = markProject([{ id: 'cap', mark: 'label', at: { x: 0.5, y: 0.5 } }])
    const kept = projectAfterSlotElements(project, 'a', [
      ...project.set.slots[0].elements!,
      { id: 'o', mark: 'outline', at: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
    ])
    expect(kept.copies.en.a.chips).toEqual({ cap: 'Free money' })
    expect(projectAfterSlotElements(project, 'a', []).copies.en.a.chips).toBeUndefined()
  })

  it('lets the agent tools add every mark kind', () => {
    const add = TOOLS.find((t) => t.name === 'add_element')!
    const element = (el: Record<string, unknown>) => inputProblems(add.input, { slot: 'a', element: el })
    expect(element({ mark: 'step', n: 1, node: ['Rent', '$1,000'], side: 'left' })).toEqual([])
    expect(
      element({
        mark: 'arrow',
        from: { textBlock: true, side: 'bottom' },
        to: { node: '$8,430' },
        curve: 0.3,
      }),
    ).toEqual([])
    expect(element({ mark: 'highlight', at: { x: 0.5, y: 0.5, w: 0.2, h: 0.05 }, opacity: 0.7 })).toEqual([])
    expect(element({ mark: 'label', rect: { x: 0, y: 0, w: 0.5, h: 0.1 }, size: 0.03 })).toEqual([])
    expect(element({ mark: 'arrow', from: { spot: 1 }, to: {} })).toEqual([
      'input.element.from.spot is not a known field',
    ])
  })
})

describe('mark geometry', () => {
  const box: Frame = { cx: 100, cy: 100, w: 40, h: 20, angle: 0 }

  it('finds the points beside a target and where a line leaves it', () => {
    expect(sidePoint(box, 'left', 5)).toEqual({ x: 75, y: 100 })
    expect(sidePoint(box, 'bottom', 0)).toEqual({ x: 100, y: 110 })
    expect(sidePoint(box, 'center', 9)).toEqual({ x: 100, y: 100 })
    const edge = edgeToward(box, { x: 100, y: 0 }, 4)
    expect(edge.x).toBeCloseTo(100, 10)
    expect(edge.y).toBeCloseTo(86, 10)
    const turned = sidePoint({ ...box, angle: Math.PI / 2 }, 'right', 0)
    expect(turned.x).toBeCloseTo(100, 10)
    expect(turned.y).toBeCloseTo(120, 10)
  })

  it('bends an arrow sideways by its curve and starts a free point where it lies', () => {
    const el = { curve: 0.5, from: { on: 'tile' }, to: { on: 'tile' } } as ArrowMark
    const from: Frame = { cx: 0, cy: 0, w: 0, h: 0, angle: 0 }
    const to: Frame = { cx: 100, cy: 0, w: 0, h: 0, angle: 0 }
    const { start, end, control } = arrowPath(el, from, to, 3)
    expect(start).toEqual({ x: 0, y: 0 })
    expect(end).toEqual({ x: 100, y: 0 })
    expect(control).toEqual({ x: 50, y: 50 })
  })

  it('maps a part of the screenshot onto the device, cut to the visible screen', () => {
    const device = getDevice('pixel-9-pro')
    const placement = {
      box: { x: 0, y: 0, w: 200, h: 200 / frameAspect(device) },
      angle: 0,
      device,
      iw: 100,
      ih: 400,
    }
    const { screen } = deviceScreen(placement.box, device)
    const whole = screenFrame(placement, { x: 0, y: 0, w: 1, h: 1 }, 0)!
    expect(whole.w).toBeCloseTo(screen.w, 6)
    expect(whole.cy - whole.h / 2).toBeCloseTo(screen.y, 6)
    expect(screenFrame(placement, { x: 0, y: 0.9, w: 1, h: 0.1 }, 0)).toBeNull()
  })

  it('reads a mark colour from the set and writes on it legibly', () => {
    expect(markColor({ ...DEFAULT_SETTINGS, accentBar: '#123456' })).toBe('#123456')
    expect(markColor({ ...DEFAULT_SETTINGS, eyebrowColor: '#654321' })).toBe('#654321')
    expect(markColor(DEFAULT_SETTINGS)).toBe('#ff4b2b')
    expect(readableOn('#ff4b2b')).toBe('#ffffff')
    expect(readableOn('#ffe27a')).toBe('#111114')
    expect(readableOn('#ffe27acc')).toBe('#111114')
  })
})

describe('renderScene: marks, browser frame and depth', () => {
  const pixel = (data: Uint8ClampedArray, w: number, x: number, y: number) =>
    Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 3))

  const step = (fields: Partial<MarkElement> = {}): MarkElement =>
    ({
      id: 's',
      mark: 'step',
      at: { on: 'tile', x: 0.5, y: 0.95, w: 0, h: 0 },
      n: '1',
      size: 0.08,
      color: '#ff0000',
      ...fields,
    }) as MarkElement

  it('draws marks on top, deterministically', () => {
    const plain = render(400, 800, { layout: 'text-top' })
    const marked = render(400, 800, { layout: 'text-top' }, [
      step(),
      {
        id: 'a',
        mark: 'arrow',
        from: { on: 'text', side: 'bottom' },
        to: { on: 'screen', rect: { x: 0.1, y: 0.3, w: 0.5, h: 0.1 }, pad: 0 },
        curve: 0.3,
        stroke: 0.01,
      },
      {
        id: 'h',
        mark: 'highlight',
        at: { on: 'screen', rect: { x: 0, y: 0.5, w: 1, h: 0.08 }, pad: 0 },
        opacity: 0.85,
      },
      { id: 'o', mark: 'outline', at: { on: 'tile', x: 0.5, y: 0.5, w: 0.4, h: 0.1 }, stroke: 0.01 },
      {
        id: 'c',
        mark: 'label',
        at: { on: 'tile', x: 0.3, y: 0.8, w: 0, h: 0 },
        caption: 'Free money',
        size: 0.03,
      },
    ])
    expect(sha(marked)).not.toBe(sha(plain))
    expect(sha(marked)).toBe(
      sha(
        render(400, 800, { layout: 'text-top' }, [
          step(),
          {
            id: 'a',
            mark: 'arrow',
            from: { on: 'text', side: 'bottom' },
            to: { on: 'screen', rect: { x: 0.1, y: 0.3, w: 0.5, h: 0.1 }, pad: 0 },
            curve: 0.3,
            stroke: 0.01,
          },
          {
            id: 'h',
            mark: 'highlight',
            at: { on: 'screen', rect: { x: 0, y: 0.5, w: 1, h: 0.08 }, pad: 0 },
            opacity: 0.85,
          },
          { id: 'o', mark: 'outline', at: { on: 'tile', x: 0.5, y: 0.5, w: 0.4, h: 0.1 }, stroke: 0.01 },
          {
            id: 'c',
            mark: 'label',
            at: { on: 'tile', x: 0.3, y: 0.8, w: 0, h: 0 },
            caption: 'Free money',
            size: 0.03,
          },
        ]),
      ),
    )
    expect(pixel(render(400, 800, { layout: 'text-top' }, [step()]), 400, 200 - 10, 760)).toEqual([255, 0, 0])
  })

  it('sizes a mark by the shorter side of the tile', () => {
    const wide = render(800, 400, { layout: 'landscape-center' }, [
      step({ at: { on: 'tile', x: 0.5, y: 0.5, w: 0, h: 0 } } as Partial<MarkElement>),
    ])
    expect(pixel(wide, 800, 400 + 14, 400 / 2)).toEqual([255, 0, 0])
    expect(pixel(wide, 800, 400 + 19, 400 / 2)).not.toEqual([255, 0, 0])
  })

  it('draws a browser window with its address bar and the page below it', () => {
    const browser = DEVICES.find((d) => d.id === 'browser')!
    const box = { x: 0, y: 0, w: 1000, h: 1000 / frameAspect(browser) }
    expect(deviceScreen(box, browser).screen.y).toBeCloseTo(50, 10)
    const settings = { layout: 'landscape-center' as const, deviceId: 'browser' }
    const blank = render(960, 540, settings)
    const withUrl = render(960, 540, { ...settings, browserUrl: 'getalife.app' })
    expect(sha(withUrl)).not.toBe(sha(blank))
    expect(sha(withUrl)).toBe(sha(render(960, 540, { ...settings, browserUrl: 'getalife.app' })))
  })

  it('blurs only the back devices and lets the stack run out at the bottom', () => {
    const duo = { layout: 'text-top' as const, positionId: 'duo', deviceId: 'pixel-9-pro' }
    const sharp = render(400, 800, duo)
    const blurred = render(400, 800, { ...duo, backBlur: true })
    expect(sha(blurred)).not.toBe(sha(sharp))
    expect(sha(blurred)).toBe(sha(render(400, 800, { ...duo, backBlur: true })))
    expect(pixel(blurred, 400, 260, 600)).toEqual(pixel(sharp, 400, 260, 600))
    expect(render(400, 800, { ...duo, positionId: 'center', backBlur: true })).toEqual(
      render(400, 800, { ...duo, positionId: 'center' }),
    )

    const dark = render(400, 800, { ...duo, deviceFade: 'dark' })
    expect(pixel(dark, 400, 200, 799).every((c) => c < 30)).toBe(true)
    expect(pixel(dark, 400, 200, 300)).toEqual(pixel(sharp, 400, 200, 300))
    const solid = { ...duo, background: { kind: 'solid', color: '#336699' } as const }
    const faded = render(400, 800, { ...solid, deviceFade: 'background' })
    expect(pixel(faded, 400, 260, 799)).toEqual([0x33, 0x66, 0x99])
    expect(pixel(faded, 400, 260, 400)).toEqual(pixel(render(400, 800, solid), 400, 260, 400))
  }, 60_000)
})

describe('highlight on a dark page', () => {
  const scene = (w: number, h: number) => ({
    W: w,
    w,
    h,
    unit: Math.min(w, h),
    screen: null,
    textBox: () => null,
    settings: DEFAULT_SETTINGS,
  })
  const mark: MarkElement = {
    id: 'h',
    mark: 'highlight',
    at: { on: 'tile', x: 0.5, y: 0.5, w: 0.6, h: 0.1 },
    opacity: 0.85,
    color: '#ffe27a',
  }
  const draw = (page: string) => {
    const ctx = createCanvas(200, 200).getContext('2d') as unknown as CanvasRenderingContext2D
    ctx.fillStyle = page
    ctx.fillRect(0, 0, 200, 200)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(90, 96, 20, 8)
    drawMarks(ctx, [mark], scene(200, 200))
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
    return { at, data: ctx.getImageData(0, 0, 200, 200).data }
  }

  it('lifts the band behind the text in the marker colour and leaves light text the lightest', () => {
    const { at } = draw('#1c1c1e')
    const band = at(70, 100)
    expect(band[0]).toBeGreaterThan(80)
    expect(band[0]).toBeGreaterThan(band[2] + 20)
    expect(Math.min(...at(100, 100))).toBeGreaterThanOrEqual(245)
    expect(at(100, 20)).toEqual([28, 28, 30])
  })

  it('is deterministic', () => {
    expect(sha(draw('#1c1c1e').data)).toBe(sha(draw('#1c1c1e').data))
  })

  it('still multiplies on a light page', () => {
    const [r, g, b] = draw('#f0f0f0').at(100, 100)
    expect(r).toBe(255)
    expect(b).toBeLessThan(g - 60)
  })
})
