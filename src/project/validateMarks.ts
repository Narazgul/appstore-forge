import { isNodeTarget } from './bridge'
import { MARK_KINDS, markTargets } from './types'
import type { SlotMark, SlotMarkTarget } from './types'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const SIDES = ['center', 'left', 'right', 'top', 'bottom']
const PAD = { min: 0, max: 0.2 }
const TARGET_FIELDS = ['rect', 'node', 'pad', 'at', 'textBlock', 'side']

type Range = { min: number; max: number }
type Rule = Range | 'hex' | 'step'
const MARK_FIELDS: Record<SlotMark['mark'], Record<string, Rule>> = {
  step: { n: 'step', size: { min: 0.02, max: 0.3 }, color: 'hex', textColor: 'hex' },
  arrow: { curve: { min: -1, max: 1 }, stroke: { min: 0.002, max: 0.05 }, color: 'hex' },
  highlight: { opacity: { min: 0.1, max: 1 }, color: 'hex' },
  outline: { stroke: { min: 0.002, max: 0.05 }, color: 'hex' },
  label: { size: { min: 0.008, max: 0.2 }, color: 'hex', textColor: 'hex' },
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** What is wrong with a part of the screenshot given as fractions, or null. */
export function rectProblem(rect: unknown): string | null {
  const r = rect as Record<string, unknown> | null
  const nums = r && typeof r === 'object' ? [r.x, r.y, r.w, r.h] : []
  if (nums.length !== 4 || !nums.every(finite)) return 'rect needs finite numbers x, y, w, h'
  const [x, y, w, h] = nums as number[]
  if (w <= 0 || h <= 0) return 'rect needs w and h above 0'
  if (x < 0 || y < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9)
    return 'rect must lie inside the screenshot (fractions 0..1)'
  return null
}

/** Whether a mark target points into the slot's own screenshot. */
export const onScreen = (t: SlotMarkTarget) => t.rect !== undefined || t.node !== undefined

function targetProblems(t: unknown, label: string): string[] {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return [`${label} must be an object`]
  const target = t as SlotMarkTarget
  const problems: string[] = []
  const kinds = [
    target.rect !== undefined,
    target.node !== undefined,
    target.at !== undefined,
    target.textBlock !== undefined,
  ]
  if (kinds.filter(Boolean).length !== 1)
    problems.push(`${label} needs exactly one of rect, node, at or textBlock`)
  if (target.rect !== undefined) {
    const problem = rectProblem(target.rect)
    if (problem) problems.push(`${label} ${problem}`)
  }
  if (target.node !== undefined && !isNodeTarget(target.node))
    problems.push(`${label} node must be a non-empty string or an array of at least two of them`)
  if (target.pad !== undefined) {
    if (!onScreen(target)) problems.push(`${label} pad only applies to rect or node`)
    else if (!finite(target.pad) || target.pad < PAD.min || target.pad > PAD.max)
      problems.push(`${label} pad ${target.pad} outside ${PAD.min}–${PAD.max}`)
  }
  if (target.at !== undefined) {
    const at = target.at as Record<string, unknown> | null
    if (!at || typeof at !== 'object' || !finite(at.x) || !finite(at.y))
      problems.push(`${label} at needs finite numbers x and y`)
    else if ([at.w, at.h].some((n) => n !== undefined && (!finite(n) || n < 0)))
      problems.push(`${label} at w and h must be numbers of at least 0`)
  }
  if (target.textBlock !== undefined && target.textBlock !== true)
    problems.push(`${label} textBlock must be true`)
  if (target.side !== undefined && !SIDES.includes(target.side))
    problems.push(`${label} side must be one of ${SIDES.join(', ')}`)
  return problems
}

/** Everything wrong with one mark's own fields; whether a `node` resolves needs each locale's capture. */
export function markProblems(el: SlotMark): string[] {
  const fields = MARK_FIELDS[el.mark]
  if (!fields) return [`unknown mark "${el.mark}"; one of ${MARK_KINDS.join(', ')}`]
  const problems: string[] = []
  const own = new Set(['id', 'mark', ...(el.mark === 'arrow' ? ['from', 'to'] : TARGET_FIELDS)])
  if (el.mark === 'arrow') {
    problems.push(...targetProblems(el.from, 'from'), ...targetProblems(el.to, 'to'))
  } else problems.push(...targetProblems(el, 'target'))
  if (el.mark === 'step' && el.n === undefined) problems.push('needs n')
  for (const [key, value] of Object.entries(el)) {
    if (value === undefined || own.has(key)) continue
    const rule = fields[key]
    if (!rule) problems.push(`field ${key} does not apply to a ${el.mark}`)
    else if (rule === 'hex') {
      if (typeof value !== 'string' || !HEX.test(value)) problems.push(`${key} is not a hex colour: ${value}`)
    } else if (rule === 'step') {
      const ok =
        (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 999) ||
        (typeof value === 'string' && !!value.trim() && [...value].length <= 3)
      if (!ok) problems.push('n must be a whole number 0–999 or up to three characters')
    } else if (!finite(value) || value < rule.min || value > rule.max)
      problems.push(`${key} ${value} outside ${rule.min}–${rule.max}`)
  }
  return problems
}

/** The node names a mark looks up, each target once. */
export const markNodes = (el: SlotMark) =>
  markTargets(el).flatMap((t) =>
    t && typeof t === 'object' && isNodeTarget(t.node) && !t.rect ? [t.node] : [],
  )

const FADES = ['dark', 'background', 'none']

/** What is wrong with the frame and depth settings of a set or a slot's overrides. */
export function frameSettingProblems(s: {
  browserUrl?: unknown
  backBlur?: unknown
  deviceFade?: unknown
}): string[] {
  const problems: string[] = []
  if (s.browserUrl !== undefined && (typeof s.browserUrl !== 'string' || /[\r\n]/.test(s.browserUrl)))
    problems.push('browserUrl must be one line of text')
  if (s.backBlur !== undefined && typeof s.backBlur !== 'boolean')
    problems.push('backBlur must be true or false')
  if (s.deviceFade !== undefined && !FADES.includes(s.deviceFade as string))
    problems.push(`deviceFade must be one of ${FADES.join(', ')}`)
  return problems
}
