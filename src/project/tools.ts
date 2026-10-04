import { FONTS } from '../presets/fonts'
import { DEVICES, FRAME_COLORS } from '../presets/devices'
import { LAYOUTS } from '../presets/layouts'
import { PALETTES } from '../presets/palettes'
import { POSITIONS } from '../presets/positions'
import { EXPORT_SIZES } from '../presets/sizes'
import { TEMPLATES } from '../presets/templates'
import { GRADIENT_PRESETS, SOLID_PRESETS } from '../presets/backgrounds'
import { PAINT_MODEL, PAINT_PRICE_USD, PAINT_STYLE_IDS, type PaintStyle } from '../presets/paintStyles'
import { FINISH_DEFAULTS, IMAGE_DEFAULTS } from '../render/finishes'
import {
  freeSlotId,
  projectAfterArtworkSlotAdd,
  projectAfterChipPatch,
  projectAfterNote,
  projectAfterOverride,
  projectAfterRole,
  projectAfterScreenPatch,
  projectAfterSettings,
  projectAfterSlotAdd,
  projectAfterSlotElements,
  projectAfterSlotExtra,
  projectAfterSlotRemoval,
  projectAfterSlotSource,
  projectAfterTargetPatch,
  type SlotRole,
} from '../store'
import type { ScreenOverrides } from '../types'
import type { Gallery } from './store'
import { hasChipText } from './types'
import type {
  Project,
  ProjectLocale,
  ProjectSet,
  ProjectSettings,
  ProjectTarget,
  SlotCopy,
  SlotElement,
  TileRole,
} from './types'
import type { Issue } from './validate'

/**
 * The agent's way into a project: every operation an agent needs to build and fix pictures, each
 * with a name, a description and a JSON input schema, so the same list can drive the CLI
 * (`forge tool`) today and a tool-use loop tomorrow. Every write goes through the same
 * `projectAfter*` functions the GUI calls — there is no second way to change a set — and the
 * result always carries the set's issues, measured the way `forge check` measures them.
 *
 * Deliberately absent: approving. The stamp is a person's judgement, not an agent's.
 */

/** A file the preview wrote: one tile of one slot, for one locale and target. A host without a
 *  file system (the browser) names the tile in `file` and hands the picture over in `image`. */
export type PreviewFile = {
  slot: string
  locale: string
  target: string
  part: number
  file: string
  image?: { mediaType: 'image/png'; base64: string; width: number; height: number }
}

export type CaptureOptions = {
  out: string
  serial?: string
  port?: number
  screen?: string
  seed?: boolean
  store?: 'apple' | 'google'
  calls?: { tool: string; args?: Record<string, unknown> }[]
  settleMs?: number
  hideIme?: boolean
  package?: string
}

export type CaptureResult = {
  image: string
  nodes: string
  width: number
  height: number
  nodeCount: number
  steps: { tool: string; result: unknown }[]
}

export type BackgroundFetchOptions = {
  source: 'unsplash' | 'met' | 'aic'
  query: string
  list?: boolean
  pick?: number
  name?: string
  orientation?: 'portrait' | 'landscape' | 'squarish'
}

export type BackgroundPaintOptions = {
  file: string
  style: PaintStyle
  seed?: number
  name?: string
  dryRun?: boolean
}

/** What the tools need from the place a project lives — files on disk for the CLI. */
export interface ToolHost {
  listSets(): Promise<string[]>
  load(setId: string): Promise<Project>
  save(project: Project): Promise<void>
  /** rejects when the set already exists — never overwrites */
  create(project: Project): Promise<void>
  check(setId: string): Promise<Issue[]>
  gallery(set: ProjectSet): Promise<Record<string, Gallery>>
  /** renders into a scratch folder, never where the set's targets write */
  preview(
    setId: string,
    opts: { slots?: string[]; locales?: string[]; targets?: string[] },
  ): Promise<PreviewFile[]>
  render(
    setId: string,
    opts: { locales?: string[]; targets?: string[]; requireApproval: boolean },
  ): Promise<string[]>
  /** needs adb and a device, so only the CLI host has it */
  capture?(opts: CaptureOptions): Promise<CaptureResult>
  /** network and the project folder, so only the CLI host has them */
  fetchBackground?(opts: BackgroundFetchOptions): Promise<unknown>
  paintBackground?(opts: BackgroundPaintOptions): Promise<unknown>
  readGuidelines(): Promise<string | null>
  writeGuidelines(text: string): Promise<void>
  today(): string
}

export type JsonSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: readonly (string | number)[]
  /** null is accepted besides the declared type: "drop this field" */
  nullable?: boolean
  additionalProperties?: boolean
}

export type Tool = {
  name: string
  description: string
  input: JsonSchema
  run(host: ToolHost, input: Record<string, unknown>): Promise<unknown>
}

export class ToolError extends Error {}

/** The few schema rules the inputs use: type, required, enum, items, nullable, no unknown keys. */
export function inputProblems(schema: JsonSchema, value: unknown, path = 'input'): string[] {
  if (value === null) return schema.nullable ? [] : [`${path} must not be null`]
  const problems: string[] = []
  const typeOk = (() => {
    switch (schema.type) {
      case undefined:
        return true
      case 'object':
        return typeof value === 'object' && !Array.isArray(value)
      case 'array':
        return Array.isArray(value)
      case 'integer':
        return Number.isInteger(value)
      case 'number':
        return typeof value === 'number' && Number.isFinite(value)
      default:
        return typeof value === schema.type
    }
  })()
  if (!typeOk) return [`${path} must be ${schema.type === 'integer' ? 'an integer' : `a ${schema.type}`}`]
  if (schema.enum && !schema.enum.includes(value as string | number))
    problems.push(`${path} must be one of ${schema.enum.join(', ')}`)
  if (schema.type === 'array' && schema.items)
    (value as unknown[]).forEach((item, i) =>
      problems.push(...inputProblems(schema.items!, item, `${path}[${i}]`)),
    )
  if (schema.type === 'object' && schema.properties) {
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? [])
      if (obj[key] === undefined) problems.push(`${path}.${key} is required`)
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties[key]
      if (!sub) {
        if (schema.additionalProperties === false) problems.push(`${path}.${key} is not a known field`)
        continue
      }
      if (v !== undefined) problems.push(...inputProblems(sub, v, `${path}.${key}`))
    }
  }
  return problems
}

const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({
  type: 'string',
  description,
  ...extra,
})
const SET = str('Set id, the file name without .json. Default "default".')
const SLOT = str('Slot id.')
const LOCALE = str('Locale id, as in the set (e.g. "de").')
const strings = (description: string): JsonSchema => ({
  type: 'array',
  items: { type: 'string' },
  description,
})
const object = (
  description: string,
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema => ({ type: 'object', description, properties, required, additionalProperties: false })
const freeObject = (description: string): JsonSchema => ({ type: 'object', description })

const COPY_FIELDS: Record<string, JsonSchema> = {
  headline: str('Headline; *stars* mark highlighted words. Empty is allowed in a studio set.'),
  subhead: str('Line under the headline; empty for none.'),
  eyebrow: str('Small uppercase line above the headline; empty removes it.'),
  list: strings('feature-wall rows, 2-8 one-line entries; empty array removes them.'),
}

const setIdOf = (input: Record<string, unknown>) => (input.set as string | undefined) ?? 'default'

function slotOf(project: Project, slotId: string) {
  const slot = project.set.slots.find((s) => s.id === slotId)
  if (!slot)
    throw new ToolError(
      `Unknown slot "${slotId}" in set ${project.set.id}; slots: ${project.set.slots.map((s) => s.id).join(', ')}`,
    )
  return slot
}

function localeOf(project: Project, localeId: string) {
  if (!project.set.locales.some((l) => l.id === localeId))
    throw new ToolError(
      `Unknown locale "${localeId}" in set ${project.set.id}; locales: ${project.set.locales.map((l) => l.id).join(', ')}`,
    )
}

/** null in a patch means "drop the key", which in an override means "inherit again" (rule 8). */
function patched<T extends object>(base: T, patch: Record<string, unknown>): T {
  const next = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else if (value !== undefined) next[key] = value
  }
  return next as T
}

/** Saves, then reports the issues of what was saved — every write answers with the same check. */
async function commit(host: ToolHost, project: Project, extra: Record<string, unknown> = {}) {
  await host.save(project)
  const issues = await host.check(project.set.id)
  return { ...extra, issues }
}

function summary(project: Project) {
  const { set } = project
  return {
    id: set.id,
    purpose: set.purpose ?? 'store',
    locales: set.locales.map((l) => l.id),
    targets: set.targets,
    slots: set.slots.map((s) => ({ id: s.id, kind: s.kind, screen: s.screen, layout: s.overrides.layout })),
    approved: set.approval ? { by: set.approval.by, at: set.approval.at } : null,
  }
}

const RECT = object(
  'A part of the screenshot by hand: fractions of it (x, w of its width; y, h of its height).',
  {
    x: { type: 'number', description: 'Left edge, 0-1.' },
    y: { type: 'number', description: 'Top edge, 0-1.' },
    w: { type: 'number', description: 'Width, >0, x + w <= 1.' },
    h: { type: 'number', description: 'Height, >0, y + h <= 1.' },
  },
  ['x', 'y', 'w', 'h'],
)
const NODE: JsonSchema = {
  description:
    'A part of the screenshot from the capture: a string, or an array of at least two strings for the rectangle around all their nodes (a row made of several text nodes). Each is looked up in <screenshot>.nodes.json by exact tag, then text, then desc; no match or several is an error, never a guess.',
}
const SIDE = str(
  'Mark: where beside the target a step or label sits, or which edge an arrow end uses (default: step left of a screen target, label right of it, else centre; an arrow takes the edge facing its other end).',
  { enum: ['center', 'left', 'right', 'top', 'bottom'] },
)
const AT = object(
  'Mark target on the tile instead of the screen: centre x (fraction of the composition width), y (fraction of the tile height), optional size w (fraction of the tile width) and h (fraction of the tile height); without w/h a point.',
  {
    x: { type: 'number', description: 'Centre, fraction of the composition width.' },
    y: { type: 'number', description: 'Centre, fraction of the tile height.' },
    w: { type: 'number', description: 'Width, fraction of the tile width. Default 0.' },
    h: { type: 'number', description: 'Height, fraction of the tile height. Default 0.' },
  },
  ['x', 'y'],
)
const TEXT_BLOCK: JsonSchema = {
  type: 'boolean',
  description:
    "Mark target: true = the tile's headline block (e.g. an arrow from the headline to the screen).",
}
const MARK_END = (which: string) =>
  object(`Arrow ${which}: exactly one of rect, node, at, textBlock; optional pad (rect/node) and side.`, {
    rect: RECT,
    node: NODE,
    pad: {
      type: 'number',
      description: 'Margin around a screen target, fraction of the screenshot width, 0-0.2.',
    },
    at: AT,
    textBlock: TEXT_BLOCK,
    side: SIDE,
  })

const elementBase = (description: string) =>
  object(description, {
    id: str('Element id; free one derived from the kind when absent.'),
    artwork: str('Sticker: artwork file name (no folder, no extension), resolved like a slot artwork.'),
    shape: str('Shape kind.', { enum: ['circle', 'ring', 'blob'] }),
    chip: { type: 'boolean', description: 'true makes a text pill; its text comes from chipText.' },
    x: { type: 'number', description: 'Centre, fraction of the composition width.' },
    y: { type: 'number', description: 'Centre, fraction of the tile height.' },
    width: { type: 'number', description: 'Fraction of the tile width.' },
    rotate: { type: 'number', description: 'Degrees, clockwise.' },
    layer: str('Drawn behind or in front of the composition.', { enum: ['behind', 'front'] }),
    color: str(
      "Hex colour: shape fill, chip pill; a mark's colour (default: the set's accentBar, else eyebrowColor, else a strong red; a highlight defaults to the first highlight colour).",
    ),
    textColor: str(
      'Chip, step or label text colour, hex (marks default to white or near-black, whichever reads).',
    ),
    size: {
      type: 'number',
      description:
        "Chip and label: font size, fraction of the tile height (label 0.008-0.2, default 0.024). Loupe: diameter, fraction of the tile width, 0.05-0.9 (default: sized from the magnified target). Step: diameter, fraction of the tile's shorter side, 0.02-0.3, default 0.062.",
    },
    stroke: {
      type: 'number',
      description:
        "Ring: stroke, fraction of the diameter, 0.02-0.5. Arrow, outline: line width, fraction of the tile's shorter side, 0.002-0.05 (default 0.009 arrow, 0.008 outline).",
    },
    seed: { type: 'integer', description: 'Blob only: shape seed.' },
    shadow: { type: 'boolean', description: 'Sticker or chip shadow.' },
    effect: str(
      "Effect on the slot's own screenshot inside its device, instead of a placed element (no x, y, width, rotate, layer): lift raises the target out of the device, loupe magnifies it in a round glass, focus blurs everything else, redact pixelates or blurs it for good.",
      { enum: ['lift', 'loupe', 'focus', 'redact'] },
    ),
    rect: RECT,
    node: NODE,
    pad: {
      type: 'number',
      description:
        'Effect or mark on the screen: margin around the target, fraction of the screenshot width, 0-0.2. Default 0.',
    },
    mark: str(
      'Mark drawn over everything, instead of a placed element (no x, y, width, rotate, layer): step is a numbered circle (n), arrow a curved arrow (from, to, curve), highlight a marker stroke, outline a rounded frame, label a short caption pill (text per locale via chipText). A target is exactly one of rect or node (the screenshot, like an effect), at (a point or box on the tile) or textBlock.',
      { enum: ['step', 'arrow', 'highlight', 'outline', 'label'] },
    ),
    at: AT,
    textBlock: TEXT_BLOCK,
    side: SIDE,
    n: { description: 'Step: the number, or up to three characters.' },
    from: MARK_END('start'),
    to: MARK_END('end'),
    curve: {
      type: 'number',
      description:
        'Arrow: bend, -1 to 1, as a fraction of its length; the sign picks the side. Default 0.25.',
    },
    opacity: { type: 'number', description: 'Highlight: 0.1-1. Default 0.85.' },
    scale: { type: 'number', description: 'Lift: enlargement of the raised part, 1-1.5. Default 1.08.' },
    dim: {
      type: 'number',
      description:
        'Lift, focus: how far the rest of the screen darkens, 0-0.9. Default 0.35 (lift), 0 (focus).',
    },
    gray: {
      type: 'number',
      description: 'Lift: how far the rest of the screen loses its colour, 0-1. Default 0.',
    },
    zoom: { type: 'number', description: 'Loupe: magnification, 1.2-4. Default 2.' },
    place: str('Loupe: over the target or beside it. Default over.', {
      enum: ['over', 'above', 'below', 'left', 'right'],
    }),
    ring: str('Loupe: rim colour, hex. Default #ffffff.'),
    style: str('Redact: pixelate or blur. Default pixelate.', { enum: ['pixelate', 'blur'] }),
    strength: {
      type: 'number',
      description:
        'Focus: blur radius, fraction of the screenshot width, 0.002-0.05 (default 0.012). Redact: block size or blur radius, 0.005-0.1 (default 0.03).',
    },
  })

export const TOOLS: Tool[] = [
  {
    name: 'list_sets',
    description: 'Every set in the project with its purpose, locales, targets and slots.',
    input: object('', {}),
    async run(host) {
      const sets = []
      for (const id of await host.listSets()) sets.push(summary(await host.load(id)))
      return { sets }
    },
  },
  {
    name: 'get_set',
    description:
      'A set as stored: settings, targets, slots with their overrides and elements, plus the copy (one locale, or all).',
    input: object('', { set: SET, locale: LOCALE }),
    async run(host, input) {
      const project = await host.load(setIdOf(input))
      const locale = input.locale as string | undefined
      if (locale) localeOf(project, locale)
      return {
        set: project.set,
        copies: locale ? { [locale]: project.copies[locale] ?? {} } : project.copies,
      }
    },
  },
  {
    name: 'list_images',
    description:
      'The source screens and artwork files the repo holds for a locale: the names usable as screen, pair, extra and artwork.',
    input: object('', { set: SET, locale: LOCALE }),
    async run(host, input) {
      const project = await host.load(setIdOf(input))
      const galleries = await host.gallery(project.set)
      const locale = (input.locale as string | undefined) ?? project.set.locales[0]?.id
      if (locale) localeOf(project, locale)
      return { locale, ...(locale ? galleries[locale] : { screens: [], artwork: [] }) }
    },
  },
  {
    name: 'list_presets',
    description:
      'Valid ids for settings and targets: layouts, arrangements (positionId), sizes, devices, frame colours, fonts, palettes, background presets, templates.',
    input: object('', {}),
    async run() {
      return {
        layouts: LAYOUTS.map((l) => ({ id: l.id, label: l.label, span: l.span, deviceless: !!l.deviceless })),
        positions: POSITIONS.map((p) => ({ id: p.id, label: p.label, frames: p.placements.length })),
        sizes: EXPORT_SIZES,
        devices: DEVICES.map((d) => ({ id: d.id, label: d.label })),
        frameColors: FRAME_COLORS.map((c) => c.id),
        fonts: FONTS.map((f) => ({ id: f.id, label: f.label })),
        palettes: PALETTES,
        solidBackgrounds: SOLID_PRESETS,
        gradientBackgrounds: GRADIENT_PRESETS,
        backgroundFinishes: FINISH_DEFAULTS,
        backgroundImageDefaults: IMAGE_DEFAULTS,
        paintStyles: PAINT_STYLE_IDS,
        templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description })),
      }
    },
  },
  {
    name: 'create_set',
    description:
      'Creates a new set file. A studio set (the default) needs one locale and writes PNG or WebP anywhere in the repo; out may use {locale} and needs {n} unless the set has one tile. Never overwrites.',
    input: object(
      '',
      {
        set: str('New set id: letters, digits, - and _.'),
        purpose: str('Default studio.', { enum: ['studio', 'store'] }),
        locales: {
          type: 'array',
          description:
            'Locale ids, e.g. ["de"]; a store set gives objects { id, store: { <target>: code } }.',
        },
        targets: {
          type: 'array',
          description:
            'Each { id, sizeId, deviceId?, out } — out relative to the repo root, ending .png or .webp.',
          items: object(
            '',
            {
              id: str('Target id.'),
              sizeId: str('Size id (list_presets).'),
              deviceId: str('Device id; default pixel-9-pro.'),
              out: str('Output path template.'),
            },
            ['id', 'sizeId', 'out'],
          ),
        },
        sources: str(
          'Source screen template relative to the repo root, with {screen} and optionally {locale}.',
        ),
        artworkSources: str('Artwork template with {artwork} and optionally {locale}.'),
        settings: freeObject('Initial set-wide look (any Settings keys except sizeId/deviceId).'),
      },
      ['set', 'locales', 'targets', 'sources'],
    ),
    async run(host, input) {
      const id = input.set as string
      if (!/^[A-Za-z0-9_-]+$/.test(id))
        throw new ToolError(`Set id "${id}" may only use letters, digits, - and _`)
      const purpose = (input.purpose as 'studio' | 'store' | undefined) ?? 'studio'
      const locales = (input.locales as unknown[]).map((l): ProjectLocale => {
        if (typeof l === 'string') return { id: l }
        const o = l as ProjectLocale
        if (typeof o?.id !== 'string') throw new ToolError('Each locale is an id or { id, store }')
        return o
      })
      const targets = (input.targets as ProjectTarget[]).map((t) => ({
        id: t.id,
        sizeId: t.sizeId,
        deviceId: t.deviceId ?? 'pixel-9-pro',
        out: t.out,
      }))
      const set: ProjectSet = {
        version: 1,
        id,
        ...(purpose === 'studio' ? { purpose } : {}),
        targets,
        locales,
        sources: input.sources as string,
        ...(input.artworkSources ? { artworkSources: input.artworkSources as string } : {}),
        settings: (input.settings as Partial<ProjectSettings> | undefined) ?? {},
        slots: [],
        approval: null,
      }
      const project: Project = { set, copies: Object.fromEntries(locales.map((l) => [l.id, {}])) }
      await host.create(project)
      return { created: id, issues: await host.check(id) }
    },
  },
  {
    name: 'add_slot',
    description:
      'Appends a tile: kind screen (needs a source screen name) or artwork (no screen: copy, stickers, shapes, chips or an arrangement artwork). Optional copy per locale and initial overrides.',
    input: object(
      '',
      {
        set: SET,
        slot: str('New slot id; derived from the screen name when absent.'),
        kind: str('Default screen.', { enum: ['screen', 'artwork'] }),
        screen: str('Source screen name (list_images).'),
        overrides: freeObject('Per-tile settings, e.g. { "layout": "text-top", "positionId": "center" }.'),
        copy: freeObject('Per locale: { "<locale>": { headline, subhead, eyebrow?, list? } }.'),
      },
      [],
    ),
    async run(host, input) {
      let project = await host.load(setIdOf(input))
      const kind = (input.kind as string | undefined) ?? 'screen'
      const screen = input.screen as string | undefined
      if (kind === 'screen' && !screen) throw new ToolError('A screen slot needs "screen"')
      if (kind === 'artwork' && screen) throw new ToolError('An artwork slot names no screen')
      const taken = project.set.slots.map((s) => s.id)
      const wanted = input.slot as string | undefined
      if (wanted && taken.includes(wanted)) throw new ToolError(`Slot "${wanted}" exists already`)
      const id = wanted ? freeSlotId(taken, wanted) : freeSlotId(taken, screen ?? 'artwork')
      project =
        kind === 'artwork'
          ? projectAfterArtworkSlotAdd(project, id)
          : projectAfterSlotAdd(project, id, screen!)
      if (input.overrides)
        project = projectAfterOverride(project, id, patched({}, input.overrides as Record<string, unknown>))
      for (const [localeId, copy] of Object.entries(
        (input.copy as Record<string, Partial<SlotCopy>>) ?? {},
      )) {
        localeOf(project, localeId)
        project = projectAfterScreenPatch(project, localeId, id, copy)
      }
      return commit(host, project, { slot: id })
    },
  },
  {
    name: 'remove_slot',
    description: 'Removes a tile and its copy in every locale.',
    input: object('', { set: SET, slot: SLOT }, ['slot']),
    async run(host, input) {
      const project = await host.load(setIdOf(input))
      slotOf(project, input.slot as string)
      return commit(host, projectAfterSlotRemoval(project, input.slot as string))
    },
  },
  {
    name: 'update_slot',
    description:
      'Changes one tile like the GUI does. overrides is a patch over the tile settings (null drops a key so the tile inherits the set again); screen/pair/pairPrev/artwork name images (null clears all but screen); extra lists mosaic cells; note and role draw nothing.',
    input: object(
      '',
      {
        set: SET,
        slot: SLOT,
        overrides: freeObject('Patch, e.g. { "layout": "hero", "tilt": -4, "textOffset": null }.'),
        screen: str('Source screen name.'),
        pair: str('Screen for the next frame of a multi-device arrangement.', { nullable: true }),
        pairPrev: str('Screen for the previous frame.', { nullable: true }),
        artwork: str('Artwork beside the device in an arrangement with an artwork placement.', {
          nullable: true,
        }),
        extra: strings('Mosaic cells 2..n (3-5 names); empty array removes them.'),
        note: str('Open feedback for whoever regenerates the screenshot; empty removes it.'),
        role: str('Place in the deck.', {
          enum: ['hero', 'difference', 'feature', 'proof', 'closer'],
          nullable: true,
        }),
      },
      ['slot'],
    ),
    async run(host, input) {
      let project = await host.load(setIdOf(input))
      const slotId = input.slot as string
      const slot = slotOf(project, slotId)
      if (input.overrides)
        project = projectAfterOverride(
          project,
          slotId,
          patched<ScreenOverrides>(slot.overrides, input.overrides as Record<string, unknown>),
        )
      for (const role of ['screen', 'pair', 'pairPrev', 'artwork'] as SlotRole[]) {
        if (input[role] === undefined) continue
        if (role === 'screen' && input[role] === null) throw new ToolError('screen cannot be cleared')
        project = projectAfterSlotSource(project, slotId, role, input[role] as string | null)
      }
      if (input.extra) project = projectAfterSlotExtra(project, slotId, input.extra as string[])
      if (input.note !== undefined) project = projectAfterNote(project, slotId, input.note as string)
      if (input.role !== undefined)
        project = projectAfterRole(project, slotId, (input.role as TileRole | null) ?? undefined)
      return commit(host, project)
    },
  },
  {
    name: 'update_settings',
    description:
      'Changes the set-wide look every tile inherits (background, textColor, highlights, fontId, layout, positionId, deviceScale, ...; browserUrl is the address-field text of the browser device, backBlur: true blurs the back devices of a duo or trio, deviceFade "dark" or "background" lets the device run out at the bottom, "none" on a tile switches an inherited fade off); background may carry image { src, focusX, focusY, zoom, blur, brightness } and finish [{ kind: grain|motion|halftone|newsprint|dither|riso|duotone|reeded, ... }], see list_presets and bg_fetch). null drops a key back to its default.',
    input: object('', { set: SET, settings: freeObject('Patch over the set settings.') }, ['settings']),
    async run(host, input) {
      const project = await host.load(setIdOf(input))
      const patch = input.settings as Record<string, unknown>
      if ('sizeId' in patch || 'deviceId' in patch)
        throw new ToolError('sizeId and deviceId belong to a target: use update_target')
      const clear = Object.keys(patch).filter((k) => patch[k] === null) as (keyof ProjectSettings)[]
      const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null))
      return commit(host, projectAfterSettings(project, set as Partial<ProjectSettings>, clear))
    },
  },
  {
    name: 'update_target',
    description: "Changes a target's size or device.",
    input: object(
      '',
      { set: SET, target: str('Target id.'), sizeId: str('Size id.'), deviceId: str('Device id.') },
      ['target'],
    ),
    async run(host, input) {
      const project = await host.load(setIdOf(input))
      const id = input.target as string
      if (!project.set.targets.some((t) => t.id === id)) throw new ToolError(`Unknown target "${id}"`)
      const patch: Partial<Pick<ProjectTarget, 'sizeId' | 'deviceId'>> = {}
      if (input.sizeId) patch.sizeId = input.sizeId as string
      if (input.deviceId) patch.deviceId = input.deviceId as string
      return commit(host, projectAfterTargetPatch(project, id, patch))
    },
  },
  {
    name: 'set_copy',
    description:
      "Writes a tile's text for one locale. Only the given fields change; chips maps chip and label element ids to their text.",
    input: object(
      '',
      {
        set: SET,
        locale: LOCALE,
        slot: SLOT,
        ...COPY_FIELDS,
        chips: freeObject('{ "<chip or label id>": "text" }.'),
      },
      ['locale', 'slot'],
    ),
    async run(host, input) {
      let project = await host.load(setIdOf(input))
      const { locale, slot } = input as { locale: string; slot: string }
      localeOf(project, locale)
      slotOf(project, slot)
      const patch = Object.fromEntries(
        Object.keys(COPY_FIELDS)
          .filter((k) => input[k] !== undefined)
          .map((k) => [k, input[k]]),
      ) as Partial<SlotCopy>
      if (Object.keys(patch).length) project = projectAfterScreenPatch(project, locale, slot, patch)
      for (const [chipId, text] of Object.entries((input.chips as Record<string, string>) ?? {}))
        project = projectAfterChipPatch(project, locale, slot, chipId, text)
      return commit(host, project)
    },
  },
  {
    name: 'add_element',
    description:
      'Adds a sticker (artwork), deco shape (shape + color), text pill (chip: true + chipText per locale), a screen effect (effect + rect or node: lift, loupe, focus, redact) or a mark (mark: step, arrow, highlight, outline, label; a label takes chipText) to a tile. Placed elements need x, y, width; an effect or a mark has none.',
    input: object(
      '',
      {
        set: SET,
        slot: SLOT,
        element: elementBase('The element; exactly one of artwork, shape, chip, effect, mark.'),
        chipText: freeObject('Chip or label: { "<locale>": "text" } — every locale needs one.'),
      },
      ['slot', 'element'],
    ),
    async run(host, input) {
      let project = await host.load(setIdOf(input))
      const slotId = input.slot as string
      const slot = slotOf(project, slotId)
      const elements = slot.elements ?? []
      const el = {
        ...(input.element as SlotElement & {
          shape?: string
          artwork?: string
          effect?: string
          mark?: string
        }),
      }
      if (el.effect === undefined && el.mark === undefined) {
        const missing = (['x', 'y', 'width'] as const).filter(
          (k) => (el as Record<string, unknown>)[k] === undefined,
        )
        if (missing.length)
          throw new ToolError(`element.${missing.join(', element.')} required for a placed element`)
      }
      const base = el.artwork ?? el.shape ?? el.effect ?? el.mark ?? ('chip' in el ? 'chip' : 'element')
      el.id =
        el.id ??
        freeSlotId(
          elements.map((e) => e.id),
          base,
        )
      if (elements.some((e) => e.id === el.id)) throw new ToolError(`Element "${el.id}" exists already`)
      project = projectAfterSlotElements(project, slotId, [...elements, el as SlotElement])
      if (hasChipText(el as SlotElement))
        for (const [localeId, text] of Object.entries((input.chipText as Record<string, string>) ?? {})) {
          localeOf(project, localeId)
          project = projectAfterChipPatch(project, localeId, slotId, el.id, text)
        }
      return commit(host, project, { element: el.id })
    },
  },
  {
    name: 'update_element',
    description:
      'Changes fields of one element (move, resize, recolour, layer; for an effect or a mark its target rect, node, at or textBlock, pad, side and its own settings; for an arrow its from or to as a whole); null drops an optional field.',
    input: object(
      '',
      { set: SET, slot: SLOT, element: str('Element id.'), patch: freeObject('Fields to change.') },
      ['slot', 'element', 'patch'],
    ),
    async run(host, input) {
      const project = await host.load(setIdOf(input))
      const slotId = input.slot as string
      const elements = slotOf(project, slotId).elements ?? []
      const id = input.element as string
      if (!elements.some((e) => e.id === id)) throw new ToolError(`Unknown element "${id}" on slot ${slotId}`)
      if ('id' in (input.patch as object))
        throw new ToolError('An element id cannot change; remove and add instead')
      const next = elements.map((e) => (e.id === id ? patched(e, input.patch as Record<string, unknown>) : e))
      return commit(host, projectAfterSlotElements(project, slotId, next))
    },
  },
  {
    name: 'remove_element',
    description: "Removes one element from a tile; a chip's or label's text goes with it in every locale.",
    input: object('', { set: SET, slot: SLOT, element: str('Element id.') }, ['slot', 'element']),
    async run(host, input) {
      const project = await host.load(setIdOf(input))
      const slotId = input.slot as string
      const elements = slotOf(project, slotId).elements ?? []
      const id = input.element as string
      if (!elements.some((e) => e.id === id)) throw new ToolError(`Unknown element "${id}" on slot ${slotId}`)
      return commit(
        host,
        projectAfterSlotElements(
          project,
          slotId,
          elements.filter((e) => e.id !== id),
        ),
      )
    },
  },
  {
    name: 'check',
    description: 'Validates the set the way forge check does: errors block a render, warnings are advice.',
    input: object('', { set: SET }),
    async run(host, input) {
      return { issues: await host.check(setIdOf(input)) }
    },
  },
  {
    name: 'preview',
    description:
      'Renders tiles as PNG into a scratch folder and returns the file paths, to look at them before anything is written for real. Default: every slot, the first locale, the first target.',
    input: object('', {
      set: SET,
      slots: strings('Only these slots.'),
      locale: LOCALE,
      target: str('Target id.'),
    }),
    async run(host, input) {
      const setId = setIdOf(input)
      const project = await host.load(setId)
      const locale = (input.locale as string | undefined) ?? project.set.locales[0]?.id
      if (!locale) throw new ToolError('The set has no locale')
      localeOf(project, locale)
      const target = (input.target as string | undefined) ?? project.set.targets[0]?.id
      if (!target) throw new ToolError('The set has no target')
      const slots = input.slots as string[] | undefined
      for (const s of slots ?? []) slotOf(project, s)
      const files = await host.preview(setId, { slots, locales: [locale], targets: [target] })
      return { files, issues: await host.check(setId) }
    },
  },
  {
    name: 'render',
    description:
      "Renders the set for real, to its targets' out paths. A store set renders for upload only with requireApproval.",
    input: object('', {
      set: SET,
      locales: strings('Only these locales.'),
      targets: strings('Only these targets.'),
      requireApproval: { type: 'boolean', description: 'Refuse without a valid stamp (store sets).' },
    }),
    async run(host, input) {
      const files = await host.render(setIdOf(input), {
        locales: input.locales as string[] | undefined,
        targets: input.targets as string[] | undefined,
        requireApproval: (input.requireApproval as boolean | undefined) ?? false,
      })
      return { files }
    },
  },
  {
    name: 'capture',
    description:
      'Takes a screenshot of the debug app on an Android device: optionally seeds the demo data and opens a screen through the dev MCP, sets the status bar to 9:41 with full battery and signal, and writes <out>.png plus <out>.nodes.json (position of every element with a testTag, text or description). Runs against a real device; the file paths are relative to the project folder.',
    input: object(
      '',
      {
        out: str('Output path of the PNG, relative to the project folder (".png" is added when missing).'),
        serial: str('adb serial of the device; default from FORGE_ADB_SERIAL.'),
        port: { type: 'integer', description: 'Local port forwarded to the dev MCP. Default 8765.' },
        screen: str('Screen for dev_goto_screen, e.g. "budget".'),
        seed: { type: 'boolean', description: 'Run dev_seed_screenshot_data first (takes over a minute).' },
        store: str('With seed: which pay brand to show.', { enum: ['apple', 'google'] }),
        calls: {
          type: 'array',
          description: 'More dev MCP calls, run in order after seed and screen.',
          items: object('', { tool: str('Dev MCP tool name.'), args: freeObject('Its arguments.') }, [
            'tool',
          ]),
        },
        settleMs: {
          type: 'integer',
          description: 'Wait before the shot so the screen is calm. Default 1500.',
        },
        hideIme: {
          type: 'boolean',
          description:
            'Close the on-screen keyboard before the shot: sends Back only while the keyboard is shown, fails if it stays open.',
        },
        package: str(
          'App package that must be in front; default FORGE_APP_PACKAGE or app.tinygiants.getalife.debug. The capture refuses (and writes nothing) when the screen is off, another app is in front or a step reports vaultUnlockRequired.',
        ),
      },
      ['out'],
    ),
    async run(host, input) {
      if (!host.capture)
        throw new ToolError('capture needs a device and adb; run it through forge capture or forge tool')
      return host.capture(input as unknown as CaptureOptions)
    },
  },
  {
    name: 'bg_fetch',
    description:
      'Loads a background picture once into the project folder (hintergruende/<name>.jpg) and records its credit in hintergruende/credits.json: a photo from Unsplash (needs UNSPLASH_ACCESS_KEY; demo keys allow 50 requests an hour, a fetch costs two, a list one) or a public-domain (CC0) painting from The Met or the Art Institute of Chicago. Answers with src (path from the repo root) and average (the mean colour). Use it as settings.background = { kind: "solid", color: <average>, image: { src, focusX, focusY, zoom, blur, brightness }, finish: [...] }; the colour shows while the picture loads, the contrast checks measure the picture behind the text. list: true only shows candidates.',
    input: object(
      '',
      {
        source: str('Where from.', { enum: ['unsplash', 'met', 'aic'] }),
        query: str('Search words, or id:<id> for one known photo or object.'),
        list: { type: 'boolean', description: 'Only list up to 10 candidates with their pick number.' },
        pick: { type: 'integer', description: 'Which candidate to load, from 1. Default 1.' },
        name: str('File name without extension; default <source>-<id>.'),
        orientation: str('Unsplash only.', { enum: ['portrait', 'landscape', 'squarish'] }),
      },
      ['source', 'query'],
    ),
    async run(host, input) {
      if (!host.fetchBackground) throw new ToolError('bg_fetch needs the network; run it through forge tool')
      return host.fetchBackground(input as unknown as BackgroundFetchOptions)
    },
  },
  {
    name: 'bg_paint',
    description: `Repaints a background picture once through fal.ai (${PAINT_MODEL}, image to image, about $${PAINT_PRICE_USD} per call, key FAL_AI) and keeps it as a new file next to the source, with model, prompt, seed and the source's own credit in credits.json. It costs money on every call: try dryRun first, never loop it. Use the new src as background.image.`,
    input: object(
      '',
      {
        file: str('The source picture, path from the repo root (e.g. a bg_fetch src).'),
        style: str('Painting style.', { enum: PAINT_STYLE_IDS }),
        seed: { type: 'integer', description: 'Same seed, same picture. Default 1.' },
        name: str('File name without extension; default <source>-<style>.'),
        dryRun: { type: 'boolean', description: 'Only show the request and the price, call nothing.' },
      },
      ['file', 'style'],
    ),
    async run(host, input) {
      if (!host.paintBackground) throw new ToolError('bg_paint needs fal.ai; run it through forge tool')
      return host.paintBackground(input as unknown as BackgroundPaintOptions)
    },
  },
  {
    name: 'guidelines',
    description:
      "The project's design rules (guidelines.md). Read them before making or changing a picture, and follow them.",
    input: object('', {}),
    async run(host) {
      return { guidelines: (await host.readGuidelines()) ?? '' }
    },
  },
  {
    name: 'remember',
    description:
      'Appends a design rule to guidelines.md with today\'s date, e.g. "Ratgeber pictures always on the meadow". Use it when the user states a lasting preference.',
    input: object('', { rule: str('One rule, one line.') }, ['rule']),
    async run(host, input) {
      const rule = (input.rule as string).trim()
      if (!rule || /[\r\n]/.test(rule)) throw new ToolError('A rule is one non-empty line')
      const current = await host.readGuidelines()
      const line = `- ${host.today()}: ${rule}`
      await host.writeGuidelines(`${current ? current.replace(/\n*$/, '\n') : GUIDELINES_HEADER}${line}\n`)
      return { added: line }
    },
  },
]

export const GUIDELINES_HEADER =
  '# Guidelines\n\nDesign rules for this project, oldest first. Read before every picture.\n\n'

export const getTool = (name: string): Tool | undefined => TOOLS.find((t) => t.name === name)

/** Runs one tool after checking its input against the tool's own schema. */
export async function runTool(host: ToolHost, name: string, input: unknown): Promise<unknown> {
  const tool = getTool(name)
  if (!tool) throw new ToolError(`Unknown tool "${name}"; tools: ${TOOLS.map((t) => t.name).join(', ')}`)
  const problems = inputProblems(tool.input, input ?? {})
  if (problems.length) throw new ToolError(problems.join('; '))
  return tool.run(host, (input ?? {}) as Record<string, unknown>)
}
