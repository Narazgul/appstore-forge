import { FINISH_KINDS } from '../render/finishes'
import type { FinishKind } from '../types'
import type { ProjectSet } from './types'

type Range = { min: number; max: number }
type Rule = Range | readonly string[] | 'hex' | 'boolean' | 'seed' | 'inks'

/** Finish colours go through the renderer's own parser, which takes #rgb and #rrggbb only. */
const HEX6 = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const ANGLE: Range = { min: -360, max: 360 }

const IMAGE_FIELDS: Record<string, Rule> = {
  focusX: { min: 0, max: 1 },
  focusY: { min: 0, max: 1 },
  zoom: { min: 1, max: 4 },
  blur: { min: 0, max: 0.1 },
  brightness: { min: 0, max: 2 },
}

const FINISH_FIELDS: Record<FinishKind, Record<string, Rule>> = {
  grain: { amount: { min: 0, max: 0.5 }, size: { min: 0.0003, max: 0.02 }, mono: 'boolean', seed: 'seed' },
  motion: { length: { min: 0.002, max: 0.3 }, angle: ANGLE },
  halftone: { cell: { min: 0.003, max: 0.08 }, angle: ANGLE, paper: 'hex' },
  newsprint: { cell: { min: 0.003, max: 0.08 }, angle: ANGLE, ink: 'hex', paper: 'hex', seed: 'seed' },
  dither: { pixel: { min: 0.0005, max: 0.02 }, dark: 'hex', light: 'hex' },
  riso: {
    inks: 'inks',
    paper: 'hex',
    offset: { min: 0, max: 0.05 },
    grain: { min: 0, max: 0.5 },
    seed: 'seed',
  },
  duotone: { dark: 'hex', light: 'hex' },
  reeded: {
    rib: { min: 0.005, max: 0.2 },
    strength: { min: 0, max: 1 },
    direction: ['vertical', 'horizontal'],
  },
}

function fieldProblems(
  obj: Record<string, unknown>,
  fields: Record<string, Rule>,
  skip: string[],
  what: string,
) {
  const problems: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || skip.includes(key)) continue
    const rule = fields[key]
    if (!rule) problems.push(`${what}: field ${key} does not apply`)
    else if (rule === 'hex') {
      if (typeof value !== 'string' || !HEX6.test(value))
        problems.push(`${what}: ${key} is not a hex colour: ${value}`)
    } else if (rule === 'boolean') {
      if (typeof value !== 'boolean') problems.push(`${what}: ${key} must be true or false`)
    } else if (rule === 'seed') {
      if (!Number.isInteger(value)) problems.push(`${what}: ${key} must be an integer`)
    } else if (rule === 'inks') {
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !value.every((c) => typeof c === 'string' && HEX6.test(c))
      )
        problems.push(`${what}: ${key} must be two hex colours`)
    } else if (Array.isArray(rule)) {
      if (!rule.includes(value as string)) problems.push(`${what}: ${key} must be one of ${rule.join(', ')}`)
    } else {
      const range = rule as Range
      if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max)
        problems.push(`${what}: ${key} ${value} outside ${range.min}–${range.max}`)
    }
  }
  return problems
}

/** Everything wrong with a background's `image` and `finish`; `exists` says whether an image file
 *  is in the repo. A background without either has nothing to check here. */
export function backgroundProblems(bg: unknown, exists: (src: string) => boolean): string[] {
  if (!bg || typeof bg !== 'object') return []
  const { image, finish } = bg as { image?: unknown; finish?: unknown }
  const problems: string[] = []
  if (image !== undefined) {
    if (!image || typeof image !== 'object' || Array.isArray(image))
      problems.push('background.image must be an object')
    else {
      const src = (image as { src?: unknown }).src
      if (typeof src !== 'string' || !src.trim()) problems.push('background.image needs a src')
      else if (src.startsWith('/') || src.split('/').includes('..'))
        problems.push(`background.image.src must be a path inside the repo: ${src}`)
      else if (!exists(src)) problems.push(`Background image missing: ${src}`)
      problems.push(
        ...fieldProblems(image as Record<string, unknown>, IMAGE_FIELDS, ['src'], 'background.image'),
      )
    }
  }
  if (finish !== undefined) {
    if (!Array.isArray(finish)) problems.push('background.finish must be an array')
    else
      finish.forEach((f, i) => {
        const kind = (f as { kind?: unknown } | null)?.kind
        if (!FINISH_KINDS.includes(kind as FinishKind))
          problems.push(`background.finish[${i}]: unknown kind "${kind}"; one of ${FINISH_KINDS.join(', ')}`)
        else
          problems.push(
            ...fieldProblems(
              f as Record<string, unknown>,
              FINISH_FIELDS[kind as FinishKind],
              ['kind'],
              `background.finish[${i}] (${kind})`,
            ),
          )
      })
  }
  return problems
}

/** Every background of a set with where it sits, for `validateProject` to report against. */
export const backgroundsToCheck = (set: ProjectSet): [unknown, { slot?: string }][] => [
  [set.settings.background, {}],
  [set.settings.altColors?.background, {}],
  ...set.slots.flatMap((slot): [unknown, { slot?: string }][] => [
    [slot.overrides?.background, { slot: slot.id }],
    [slot.overrides?.altColors?.background, { slot: slot.id }],
  ]),
]
