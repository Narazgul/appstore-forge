import { isRtl } from '../presets/scripts'
import { DEFAULT_SETTINGS } from '../store'
import type {
  EffectElement,
  MarkElement,
  MarkTarget,
  Screen,
  SceneElement,
  ScreenRect,
  Settings,
} from '../types'
import { isSlotChip, isSlotEffect, isSlotMark, isSlotShape } from './types'
import type {
  NodesFile,
  Project,
  ProjectLocale,
  ProjectSet,
  ProjectTarget,
  SlotEffect,
  SlotMark,
  SlotMarkTarget,
  SlotPlaced,
} from './types'

export const imageIdFor = (localeId: string, screen: string) => `${localeId}/${screen}`

/** Own prefix, so an artwork and a screen of the same name never collide in the image registry. */
export const artworkIdFor = (localeId: string, artwork: string) => `artwork/${localeId}/${artwork}`

export const DEFAULT_ARTWORK_SOURCES = 'aso/artwork/{artwork}.png'

/** A chip's font size, as a fraction of tile height, when the slot names none — calibrated to
 *  read a touch larger than the default subhead (`h * 0.0205`, see `render/text.ts`). */
export const DEFAULT_CHIP_SIZE = 0.026

export const DEFAULT_LIFT = { scale: 1.08, dim: 0.35, gray: 0 }
export const DEFAULT_LOUPE = { zoom: 2, place: 'over' as const, ring: '#ffffff' }
export const DEFAULT_FOCUS = { strength: 0.012, dim: 0 }
export const DEFAULT_REDACT = { style: 'pixelate' as const, strength: 0.03 }

/** A capture's nodes for one locale's screen; `null` when there is no nodes file. */
export type NodesLookup = (localeId: string, screen: string) => NodesFile | null

/** The nodes file a capture writes next to its screenshot: the same path, `.nodes.json` for the
 *  image's extension. */
export const nodesPath = (set: ProjectSet, localeId: string, screen: string) =>
  sourcePath(set, localeId, screen).replace(/\.[^./]*$/, '') + '.nodes.json'

const NODE_FIELDS = ['tag', 'text', 'desc'] as const

/** What is wrong with a parsed nodes file, or null when its shape is usable. */
export function nodesFileProblem(file: unknown): string | null {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return 'must be an object'
  const { width, height, nodes } = file as Record<string, unknown>
  if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0))
    return 'needs positive width and height'
  if (!Array.isArray(nodes)) return 'needs a nodes array'
  for (const node of nodes) {
    const bounds = (node as Record<string, unknown> | null)?.bounds
    if (
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !bounds.every((n) => typeof n === 'number' && Number.isFinite(n))
    )
      return 'every node needs bounds [left, top, right, bottom]'
  }
  return null
}

/**
 * The part of the screenshot a `node` names, as fractions of the capture: the first of `tag`,
 * `text`, `desc` with exactly one exact match wins. No match anywhere, or several on the step
 * that matched first, is an error — a position is only ever taken from the real screen. Several
 * names target the rectangle around all of their nodes; every one of them has to resolve.
 */
export function resolveNode(
  file: NodesFile,
  node: string | string[],
): { rect: ScreenRect } | { error: string } {
  if (Array.isArray(node)) {
    const rects: ScreenRect[] = []
    for (const name of node) {
      const resolved = resolveNode(file, name)
      if ('error' in resolved) return resolved
      rects.push(resolved.rect)
    }
    const x = Math.min(...rects.map((r) => r.x))
    const y = Math.min(...rects.map((r) => r.y))
    return {
      rect: {
        x,
        y,
        w: Math.max(...rects.map((r) => r.x + r.w)) - x,
        h: Math.max(...rects.map((r) => r.y + r.h)) - y,
      },
    }
  }
  for (const field of NODE_FIELDS) {
    const hits = file.nodes.filter((n) => n[field] === node)
    if (hits.length > 1) return { error: `node "${node}" matches ${hits.length} nodes by ${field}` }
    if (hits.length === 1) {
      const [left, top, right, bottom] = hits[0].bounds
      if (!(right > left && bottom > top)) return { error: `node "${node}" has empty bounds` }
      return {
        rect: {
          x: left / file.width,
          y: top / file.height,
          w: (right - left) / file.width,
          h: (bottom - top) / file.height,
        },
      }
    }
  }
  return { error: `node "${node}" not found by tag, text or desc` }
}

/** Whether `node` has a shape `resolveNode` takes: one non-empty name, or at least two. */
export const isNodeTarget = (node: unknown): node is string | string[] =>
  (typeof node === 'string' && !!node.trim()) ||
  (Array.isArray(node) && node.length >= 2 && node.every((n) => typeof n === 'string' && !!n.trim()))

/** An effect's or a mark's target for one locale: its own `rect`, or its `node` looked up in that
 *  locale's capture. Null when it cannot be resolved — `validateProject` says why. */
export function effectRect(
  el: Pick<SlotEffect, 'rect' | 'node'>,
  localeId: string,
  screen: string | undefined,
  nodes: NodesLookup | undefined,
): ScreenRect | null {
  if (el.rect && el.node === undefined) return el.rect
  if (el.rect || !isNodeTarget(el.node) || !screen || !nodes) return null
  const file = nodes(localeId, screen)
  if (!file || nodesFileProblem(file)) return null
  const resolved = resolveNode(file, el.node)
  return 'rect' in resolved ? resolved.rect : null
}

function mirroredForRtl(el: SlotEffect, rect: ScreenRect, localeId: string): ScreenRect {
  if (el.effect !== 'lift' || !el.mirrorRtl || !isRtl(localeId)) return rect
  return { ...rect, x: 1 - rect.x - rect.w }
}

function sceneEffect(el: SlotEffect, rect: ScreenRect): EffectElement {
  const base = {
    id: el.id,
    rect,
    pad: el.pad ?? 0,
    ...(el.device && el.device !== 'self' ? { device: el.device } : {}),
  }
  switch (el.effect) {
    case 'lift':
      return {
        ...base,
        effect: 'lift',
        scale: el.scale ?? DEFAULT_LIFT.scale,
        dim: el.dim ?? DEFAULT_LIFT.dim,
        gray: el.gray ?? DEFAULT_LIFT.gray,
        ...(el.angle ? { angle: el.angle } : {}),
        ...(el.cutout ? { cutout: true } : {}),
        ...(el.group ? { group: el.group } : {}),
      }
    case 'loupe':
      return {
        ...base,
        effect: 'loupe',
        zoom: el.zoom ?? DEFAULT_LOUPE.zoom,
        size: el.size,
        place: el.place ?? DEFAULT_LOUPE.place,
        ring: el.ring ?? DEFAULT_LOUPE.ring,
      }
    case 'focus':
      return {
        ...base,
        effect: 'focus',
        strength: el.strength ?? DEFAULT_FOCUS.strength,
        dim: el.dim ?? DEFAULT_FOCUS.dim,
      }
    default:
      return {
        ...base,
        effect: 'redact',
        style: el.style ?? DEFAULT_REDACT.style,
        strength: el.strength ?? DEFAULT_REDACT.strength,
      }
  }
}

export const DEFAULT_STEP = { size: 0.062 }
export const DEFAULT_ARROW = { curve: 0.25, stroke: 0.009 }
export const DEFAULT_HIGHLIGHT = { opacity: 0.85 }
export const DEFAULT_OUTLINE = { stroke: 0.008 }
export const DEFAULT_LABEL = { size: 0.024 }

/** A mark target for one locale; null when it names the screen and that cannot be resolved. */
export function markTarget(
  t: SlotMarkTarget,
  localeId: string,
  screen: string | undefined,
  nodes: NodesLookup | undefined,
): MarkTarget | null {
  const side = t.side ? { side: t.side } : {}
  if (t.textBlock) return { on: 'text', ...side }
  if (t.at) return { on: 'tile', x: t.at.x, y: t.at.y, w: t.at.w ?? 0, h: t.at.h ?? 0, ...side }
  const rect = screen ? effectRect(t, localeId, screen, nodes) : null
  return rect ? { on: 'screen', rect, pad: t.pad ?? 0, ...side } : null
}

function sceneMark(
  el: SlotMark,
  localeId: string,
  screen: string | undefined,
  nodes: NodesLookup | undefined,
  caption: string | undefined,
): MarkElement | null {
  const target = (t: SlotMarkTarget) => markTarget(t, localeId, screen, nodes)
  if (el.mark === 'arrow') {
    const from = el.from && target(el.from)
    const to = el.to && target(el.to)
    if (!from || !to) return null
    return {
      id: el.id,
      mark: 'arrow',
      from,
      to,
      curve: el.curve ?? DEFAULT_ARROW.curve,
      stroke: el.stroke ?? DEFAULT_ARROW.stroke,
      color: el.color,
    }
  }
  const at = target(el)
  if (!at) return null
  switch (el.mark) {
    case 'step':
      return {
        id: el.id,
        mark: 'step',
        at,
        n: String(el.n ?? ''),
        size: el.size ?? DEFAULT_STEP.size,
        color: el.color,
        textColor: el.textColor,
      }
    case 'highlight':
      return {
        id: el.id,
        mark: 'highlight',
        at,
        opacity: el.opacity ?? DEFAULT_HIGHLIGHT.opacity,
        color: el.color,
      }
    case 'outline':
      return { id: el.id, mark: 'outline', at, stroke: el.stroke ?? DEFAULT_OUTLINE.stroke, color: el.color }
    case 'label':
      return {
        id: el.id,
        mark: 'label',
        at,
        caption: caption ?? '',
        size: el.size ?? DEFAULT_LABEL.size,
        color: el.color,
        textColor: el.textColor,
      }
    default:
      return null
  }
}

function placedElement(el: SlotPlaced, localeId: string, chipText: string | undefined): SceneElement {
  if (isSlotShape(el))
    return {
      id: el.id,
      shape: el.shape,
      color: el.color,
      stroke: el.stroke,
      seed: el.seed,
      x: el.x,
      y: el.y,
      width: el.width,
      rotate: el.rotate ?? 0,
      layer: el.layer ?? 'front',
    }
  if (isSlotChip(el))
    return {
      id: el.id,
      text: chipText ?? '',
      // Colours stay undefined here on purpose — a chip's default depends on the
      // slot's *effective* settings, which this function does not resolve (rules.md #2).
      color: el.color,
      textColor: el.textColor,
      size: el.size ?? DEFAULT_CHIP_SIZE,
      x: el.x,
      y: el.y,
      width: el.width,
      rotate: el.rotate ?? 0,
      layer: el.layer ?? 'front',
      shadow: el.shadow ?? false,
    }
  return {
    id: el.id,
    imageId: artworkIdFor(localeId, el.artwork),
    x: el.x,
    y: el.y,
    width: el.width,
    rotate: el.rotate ?? 0,
    layer: el.layer ?? 'front',
    shadow: el.shadow ?? false,
  }
}

/** `nodes` resolves an effect's `node`; without it, or when the node does not resolve, the effect
 *  is left out of the scene rather than drawn somewhere guessed. */
export function screensFor(project: Project, localeId: string, nodes?: NodesLookup): Screen[] {
  const copy = project.copies[localeId] ?? {}
  return project.set.slots.map((slot) => {
    // A hand-edited project file may give any of these the wrong JSON shape (a string instead of
    // an array, say); `validateProject` reports that as its own issue, but this bridge runs ahead
    // of that check too (`forge check`'s fits-checkers build screens before validating), so a
    // wrong type must fall back to "none" here rather than throw.
    const elements = Array.isArray(slot.elements) ? slot.elements : []
    const extra = Array.isArray(slot.extra) ? slot.extra : []
    const list = copy[slot.id]?.list
    return {
      id: slot.id,
      headline: copy[slot.id]?.headline ?? '',
      subhead: copy[slot.id]?.subhead ?? '',
      imageId: slot.kind === 'artwork' ? null : imageIdFor(localeId, slot.screen!),
      kind: slot.kind === 'artwork' ? ('artwork' as const) : undefined,
      artworkId: slot.artwork ? artworkIdFor(localeId, slot.artwork) : null,
      pairId: slot.pair ? imageIdFor(localeId, slot.pair) : null,
      pairPrevId: slot.pairPrev ? imageIdFor(localeId, slot.pairPrev) : null,
      extraIds: extra.length ? extra.map((screen) => imageIdFor(localeId, screen)) : undefined,
      overrides: { ...slot.overrides },
      lang: localeId,
      eyebrow: copy[slot.id]?.eyebrow || undefined,
      list: Array.isArray(list) && list.length ? list : undefined,
      elements: elements.length
        ? elements.flatMap((el): SceneElement[] => {
            if (isSlotEffect(el)) {
              const rect = slot.kind === 'artwork' ? null : effectRect(el, localeId, slot.screen, nodes)
              return rect ? [sceneEffect(el, mirroredForRtl(el, rect, localeId))] : []
            }
            if (isSlotMark(el)) {
              const screen = slot.kind === 'artwork' ? undefined : slot.screen
              const mark = sceneMark(el, localeId, screen, nodes, copy[slot.id]?.chips?.[el.id])
              return mark ? [mark] : []
            }
            return [placedElement(el, localeId, copy[slot.id]?.chips?.[el.id])]
          })
        : undefined,
    }
  })
}

export function settingsFor(project: Project, targetId: string): Settings {
  const target = project.set.targets.find((t) => t.id === targetId)
  if (!target) throw new Error(`Unknown target "${targetId}"`)
  return {
    ...DEFAULT_SETTINGS,
    ...project.set.settings,
    sizeId: target.sizeId,
    deviceId: target.deviceId,
  }
}

export const sourcePath = (set: ProjectSet, localeId: string, screen: string) =>
  set.sources.replaceAll('{locale}', localeId).replaceAll('{screen}', screen)

/** An artwork path with no `{locale}` names one file for every language: it is stored and fetched once. */
export const artworkIsShared = (set: ProjectSet) =>
  !(set.artworkSources ?? DEFAULT_ARTWORK_SOURCES).includes('{locale}')

export const artworkPath = (set: ProjectSet, localeId: string, artwork: string) =>
  (set.artworkSources ?? DEFAULT_ARTWORK_SOURCES)
    .replaceAll('{locale}', localeId)
    .replaceAll('{artwork}', artwork)

export const outPath = (target: ProjectTarget, storeLocale: string, n: number) =>
  target.out
    .replaceAll('{storeLocale}', storeLocale)
    .replaceAll('{locale}', storeLocale)
    .replace('{n}', String(n))

/** The folder name a locale writes under for one target: the store's code, or for a studio set
 *  without one the locale id itself. */
export const outLocale = (locale: ProjectLocale, targetId: string) => locale.store?.[targetId] ?? locale.id

export const OUT_FORMATS = ['.png', '.webp'] as const
export const outFormat = (target: ProjectTarget) =>
  target.out.toLowerCase().endsWith('.webp') ? 'webp' : 'png'

/**
 * The directory a source template points into for one locale, and the pattern its file names
 * follow. Lets a backend list every image a locale holds instead of only the ones a slot names.
 * Null when `{screen}` (or `{artwork}`) sits outside the last path segment — there is then no
 * single directory to list.
 */
export function sourceListing(
  template: string,
  localeId: string,
  token = '{screen}',
): { dir: string; match: (file: string) => string | null } | null {
  const path = template.replaceAll('{locale}', localeId)
  const cut = path.lastIndexOf('/')
  const dir = cut < 0 ? '.' : path.slice(0, cut)
  const file = cut < 0 ? path : path.slice(cut + 1)
  const at = file.indexOf(token)
  if (at < 0 || dir.includes(token)) return null
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escape(file.slice(0, at))}(.+)${escape(file.slice(at + token.length))}$`)
  return { dir, match: (name: string) => re.exec(name)?.[1] ?? null }
}

/** Own prefix in the image registry, like `artworkIdFor`. */
export const backgroundIdFor = (src: string) => `background/${src}`
