import { effectiveSettings } from '../lib/settings'
import { frameAspect, getDevice } from '../presets/devices'
import { getLayout } from '../presets/layouts'
import { isChipElement, turnsVisibly } from '../types'
import type { Screen, Settings } from '../types'
import type { Box } from './frames'
import {
  chipGeometry,
  composeDevices,
  elementBox,
  listCapSize,
  mosaicGrid,
  textFloor,
  textShifts,
  type SceneSources,
} from './scene'
import { listBlockBox, textBlockBox, type BlockBox, type TextMeasurer } from './text'

/**
 * A box turned about its own centre: the shape every manipulable part of a composition has once
 * it is drawn. `cx`/`cy`/`w`/`h` in canvas pixels, `angle` in degrees, clockwise positive — the
 * same sense as a placement's or an element's `rotate`.
 */
export type OrientedBox = { cx: number; cy: number; w: number; h: number; angle: number }

export const orient = (box: Box | BlockBox, angle = 0): OrientedBox => ({
  cx: box.x + box.w / 2,
  cy: box.y + box.h / 2,
  w: box.w,
  h: box.h,
  angle,
})

/** What the editor can grab on a tile. `parts` are what a click hits; `frame` is what the
 *  selection outline and its handles are drawn around. */
export type SceneTarget =
  | { kind: 'element'; id: string; frame: OrientedBox; parts: OrientedBox[]; rotatable: boolean }
  | { kind: 'device'; frame: OrientedBox; parts: OrientedBox[]; scalable: boolean }
  | { kind: 'text'; frame: OrientedBox; parts: OrientedBox[] }

export const targetKey = (t: SceneTarget): string => (t.kind === 'element' ? `el:${t.id}` : t.kind)

/** The four corners of `b`, clockwise from its (unturned) top left. */
export function orientedCorners(b: OrientedBox): { x: number; y: number }[] {
  const rad = (b.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [
    [-b.w / 2, -b.h / 2],
    [b.w / 2, -b.h / 2],
    [b.w / 2, b.h / 2],
    [-b.w / 2, b.h / 2],
  ].map(([x, y]) => ({ x: b.cx + x * cos - y * sin, y: b.cy + x * sin + y * cos }))
}

/** The axis-aligned box around every corner of `boxes` — the frame of a multi-device arrangement. */
function enclosing(boxes: OrientedBox[]): OrientedBox {
  const pts = boxes.flatMap(orientedCorners)
  const left = Math.min(...pts.map((p) => p.x))
  const right = Math.max(...pts.map((p) => p.x))
  const top = Math.min(...pts.map((p) => p.y))
  const bottom = Math.max(...pts.map((p) => p.y))
  return { cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top, angle: 0 }
}

/**
 * Every part of a composition the editor can move, in draw order (bottom first): `behind`
 * elements, the copy, the device arrangement, `front` elements. Built from the renderer's own
 * geometry functions — `elementBox`, `chipGeometry`, `textBlockBox`, `composeDevices`, `mosaicGrid`
 * — with the same arguments `renderScene` passes them, so a selection frame sits exactly on what
 * was drawn. `ctx` only measures text. Never draws anything: the editor's frames and handles are
 * DOM on top of the canvas, never part of the exported pixels.
 */
export function sceneTargets(
  ctx: TextMeasurer,
  w: number,
  h: number,
  screen: Screen,
  global: Settings,
  sources: SceneSources,
): SceneTarget[] {
  const settings = effectiveSettings(screen, global)
  const layout = getLayout(settings.layout)
  const W = w * layout.span
  const targets: SceneTarget[] = []

  const elementTargets = (layer: 'behind' | 'front') => {
    for (const el of screen.elements ?? []) {
      if (el.layer !== layer) continue
      let box: Box | null
      if (isChipElement(el)) box = el.text ? chipGeometry(ctx, W, w, h, el, settings, screen.lang).box : null
      else box = elementBox(el, W, w, h, sources)
      if (!box) continue
      const frame = orient(box, el.rotate)
      targets.push({ kind: 'element', id: el.id, frame, parts: [frame], rotatable: turnsVisibly(el) })
    }
  }

  elementTargets('behind')

  const shifts = textShifts(ctx, W, w, h, layout, screen, settings)
  const textBox = textBlockBox(ctx, W, w, h, layout, screen, settings, shifts.text)
  const listBox = layout.list
    ? listBlockBox(ctx, W, w, h, layout, screen, settings, listCapSize(h, settings, layout), shifts.list)
    : null
  const textParts = [textBox, listBox].filter((b): b is BlockBox => !!b).map((b) => orient(b))
  if (textParts.length)
    targets.push({
      kind: 'text',
      frame: textParts.length === 1 ? textParts[0] : enclosing(textParts),
      parts: textParts,
    })

  // An artwork-kind screen or a deviceless layout draws no device to grab.
  const device = getDevice(settings.deviceId)
  if (screen.kind !== 'artwork' && !layout.deviceless) {
    if (layout.id === 'mosaic') {
      const grid = mosaicGrid(
        layout,
        w,
        h,
        device.screenAspect,
        1 + (screen.extraIds?.length ?? 0),
        settings.deviceOffset,
      )
      if (grid) {
        const frame = orient(grid.bounds, settings.tilt)
        // The grid ignores `deviceScale` (`mosaicCells` sizes the cells itself), so no scale handle.
        targets.push({ kind: 'device', frame, parts: [frame], scalable: false })
      }
    } else {
      const parts = composeDevices(
        layout,
        settings.positionId,
        w,
        h,
        frameAspect(device),
        settings.deviceScale,
        settings.tilt,
        textFloor(layout, h),
        settings.deviceOffset,
      )
        // The same skip `renderScene` makes: a frameless or artwork placement with no image draws nothing.
        .filter(({ source, frameless }) => {
          const img = source === 'artwork' ? sources.artwork : (sources[source] ?? sources.self)
          return !!img || !(frameless || source === 'artwork')
        })
        .map(({ box, angle }) => orient(box, angle))
      if (parts.length)
        targets.push({
          kind: 'device',
          frame: parts.length === 1 ? parts[0] : enclosing(parts),
          parts,
          scalable: true,
        })
    }
  }

  elementTargets('front')
  return targets
}
