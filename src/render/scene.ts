import type { Background, Layout, PlacementSource, Screen, Settings } from '../types'
import { frameAspect, getDevice, getFrameColor } from '../presets/devices'
import { getLayout } from '../presets/layouts'
import { getPosition } from '../presets/positions'
import { effectiveSettings } from '../lib/settings'
import { drawTextBlock } from './text'
import { drawDevice, type Box } from './frames'

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, bg: Background) {
  if (bg.kind === 'solid') {
    ctx.fillStyle = bg.color
  } else {
    // CSS-style angles: 180deg runs top to bottom, 135deg top-left to bottom-right.
    const rad = ((bg.angle - 90) * Math.PI) / 180
    const dx = Math.cos(rad)
    const dy = Math.sin(rad)
    const len = Math.abs(w * dx) + Math.abs(h * dy)
    const g = ctx.createLinearGradient(
      w / 2 - (dx * len) / 2,
      h / 2 - (dy * len) / 2,
      w / 2 + (dx * len) / 2,
      h / 2 + (dy * len) / 2,
    )
    g.addColorStop(0, bg.from)
    g.addColorStop(1, bg.to)
    ctx.fillStyle = g
  }
  ctx.fillRect(0, 0, w, h)
}

/**
 * Rounded card behind the device band. Sits a little above the device and, when the layout
 * bleeds the device off the bottom, runs off-canvas too so no bottom corners show.
 */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  color: string,
) {
  const r = tileW * 0.075
  const top = h * layout.device.top - h * 0.05
  const bottom = layout.device.bottom > 1 ? h + r : Math.min(h + r, h * layout.device.bottom + h * 0.05)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(tileW * 0.045, top, W - tileW * 0.09, bottom - top, r)
  ctx.fill()
}

/**
 * Single source of truth for what a screenshot looks like. The on-screen preview and the
 * exported PNG both call this — only `w`/`h` differ — so the preview is exact, not an approximation.
 */
export type SceneSources = Partial<Record<PlacementSource, CanvasImageSource | null>>

export type DeviceBox = { box: Box; source: PlacementSource; angle: number }

/**
 * Where every device frame of a composition sits, back to front. `w`/`h` are one store tile.
 * The single source of device geometry: the renderer draws these boxes and the rhythm glyphs
 * sketch them. The glyphs pass no `minTop`, so a lifted device (hero, panorama) sits a little
 * higher in the glyph than in the export.
 */
export function composeDevices(
  layout: Layout,
  positionId: string,
  w: number,
  h: number,
  aspect: number,
  deviceScale: number,
  tilt: number,
  minTop?: number,
): DeviceBox[] {
  const W = w * layout.span
  const slot: Box = {
    x: w * layout.padX,
    y: h * layout.device.top,
    w: W - w * layout.padX * 2,
    h: h * (layout.device.bottom - layout.device.top),
  }
  // Fit one frame inside the slot, preserving aspect — or take the layout's fixed width — and
  // scale each placement from there.
  const fitW = layout.device.width !== undefined ? w * layout.device.width : Math.min(slot.w, slot.h * aspect)
  const baseW = fitW * deviceScale
  const cx = layout.device.cx !== undefined ? W * layout.device.cx : slot.x + slot.w / 2
  const cy = layout.device.cy !== undefined ? h * layout.device.cy : slot.y + slot.h / 2
  // A fixed-width layout ignores the device band, so a tall frame can climb into the copy.
  // Push the whole composition down rather than shrink it — the width is the layout's point.
  const baseH = baseW / aspect
  const lift = minTop !== undefined ? Math.max(0, minTop - (cy - baseH / 2)) : 0
  const cyClamped = cy + lift

  return getPosition(positionId).placements.map((placement) => {
    const fw = baseW * placement.scale
    const fh = fw / aspect
    return {
      box: { x: cx + placement.dx * W - fw / 2, y: cyClamped + placement.dy * h - fh / 2, w: fw, h: fh },
      source: placement.source,
      angle: placement.rotate + tilt,
    }
  })
}

/**
 * The highest the device may start before it runs into the copy: the bottom of the text band
 * plus a little air. A layout whose copy sits *below* the device yields none — there the band
 * is cleared by the device's bottom edge, and pushing the device down would bury it.
 */
export function textFloor(layout: Layout, h: number): number | undefined {
  const header = layout.text && layout.text.top < layout.device.top ? layout.text : null
  return header ? h * (header.top + header.height) + h * 0.02 : undefined
}

/** How many store tiles a screen's composition covers — the canvas must be `span` tiles wide. */
export const sceneSpan = (screen: Screen, settings: Settings): 1 | 2 =>
  getLayout(effectiveSettings(screen, settings).layout).span

/**
 * `w`/`h` are the store *tile* size. A span-2 layout draws a composition `2w` wide; the caller
 * sizes the canvas with `sceneSpan` and, on export, slices it into tiles.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  screen: Screen,
  settings: Settings,
  sources: SceneSources,
) {
  // One place resolves inheritance, so preview and export can never disagree about it.
  settings = effectiveSettings(screen, settings)
  const layout = getLayout(settings.layout)
  const W = w * layout.span
  ctx.clearRect(0, 0, W, h)
  drawBackground(ctx, W, h, settings.background)

  if (settings.backdropColor) drawBackdrop(ctx, W, w, h, layout, settings.backdropColor)
  drawTextBlock(ctx, W, w, h, layout, screen, settings)

  const device = getDevice(settings.deviceId)
  const color = getFrameColor(settings.frameColorId)
  const boxes = composeDevices(
    layout,
    settings.positionId,
    w,
    h,
    frameAspect(device),
    settings.deviceScale,
    settings.tilt,
    textFloor(layout, h),
  )

  for (const { box, source, angle } of boxes) {
    // A multi-device arrangement falls back to the current screenshot when there is no
    // neighbour, so a single-screen project still renders every frame.
    const img = sources[source] ?? sources.self ?? null

    ctx.save()
    if (angle !== 0) {
      ctx.translate(box.x + box.w / 2, box.y + box.h / 2)
      ctx.rotate((angle * Math.PI) / 180)
      ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2))
    }
    drawDevice(ctx, box, device, color, img)
    ctx.restore()
  }
}
