import { isChipElement, isShapeElement } from '../types'
import type {
  Background,
  ChipElement,
  Layout,
  PlacementSource,
  SceneElement,
  Screen,
  Settings,
  ShapeElement,
  StickerElement,
} from '../types'
import { frameAspect, getDevice, getFrameColor } from '../presets/devices'
import { getLayout } from '../presets/layouts'
import { getPosition } from '../presets/positions'
import { effectiveSettings } from '../lib/settings'
import { isRtl } from '../presets/scripts'
import {
  CHIP_HEIGHT,
  CHIP_PAD_X,
  drawLine,
  drawListBlock,
  drawTextBlock,
  fitChipText,
  headlineBaseSize,
  LIST_CAP_MULT,
  type Line,
} from './text'
import { drawArtwork, drawDevice, drawMosaicCell, drawPill, drawShape, drawSticker, type Box } from './frames'

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
export type SceneSources = Partial<Record<PlacementSource, CanvasImageSource | null>> & {
  /** sticker images, keyed by each `SceneElement.imageId` */
  elements?: Record<string, CanvasImageSource | null>
  /** the mosaic layout's cells after the first (which draws `self`), in `Screen.extraIds` order */
  extra?: (CanvasImageSource | null)[]
}

export type DeviceBox = { box: Box; source: PlacementSource; angle: number; frameless: boolean }

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
  // No device (and no artwork placement) is ever drawn for a deviceless layout, whatever the
  // arrangement asks for — the composition is copy alone.
  if (layout.deviceless) return []
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
      frameless: placement.frameless === true,
    }
  })
}

/**
 * The highest the device may start before it runs into the copy: the bottom of the text band
 * plus a little air. A layout whose copy sits *below* the device yields none — there the band
 * is cleared by the device's bottom edge, and pushing the device down would bury it.
 */
export function textFloor(layout: Layout, h: number): number | undefined {
  // There is no device to clear — `composeDevices` already returns no boxes for this layout.
  if (layout.deviceless) return undefined
  const header = layout.text && layout.text.top < layout.device.top ? layout.text : null
  return header ? h * (header.top + header.height) + h * 0.02 : undefined
}

/**
 * Outer side margin and the two gaps, all fixed fractions — margin and column gap of the tile
 * *width*, row gap of the tile *height* (unlike the width-driven values, the row gap never shrinks
 * with the cell, so two stacked rows always breathe by the same amount however big the cell is).
 * These are starting values, not a hard rule: `mosaicCells` shrinks the cell below the width they
 * imply when a count/offset combination would otherwise leave a cell less than half on-canvas.
 */
const MOSAIC_MARGIN_X = 0.06
const MOSAIC_COL_GAP_X = 0.04
const MOSAIC_ROW_GAP_Y = 0.02

/** Two columns (4 cells): the right one staggers down by this fraction of a cell's height. */
const MOSAIC_COL2_OFFSET = 0.35
/** Three columns (5–6 cells): the middle one staggers down by half a cell's height — a true
 *  brick pattern, so with one cell fewer than its neighbours (5 cells) it reads as centred
 *  between their two rows instead of pinned to the top one. */
const MOSAIC_COL3_MID_OFFSET = 0.5

/** A cell must keep at least this fraction of its own height on-canvas — a hair over the ½ the
 *  brief asks for, so the binding case doesn't leave a cell's centre sitting exactly on the
 *  bottom edge (floating point could round it either side of the last valid pixel row). */
const MOSAIC_MIN_VISIBLE = 0.51

/**
 * The boxes for a mosaic's cells, back to front — cell `0` is the slot's own screen, the rest are
 * `Screen.extraIds` in order. Four cells lay out as two columns of two; five or six switch to
 * three columns (6 = 2/2/2, 5 = 2/1/2 — the outer columns keep two rows, the middle one drops to
 * one). Column order `[0, 2, 1]` for three columns (left, right, then middle) is what produces
 * that split: filling columns round-robin in that order gives the two outer columns the extra
 * cell before the middle one ever gets a second, for any count. The middle/right column(s) then
 * stagger down (`MOSAIC_COL2_OFFSET`/`MOSAIC_COL3_MID_OFFSET`) so the grid reads as a mosaic
 * instead of a plain table. The grid starts right under the text band (`layout.device.top`, not
 * vertically centred) and is centred horizontally within the tile's padded width — trivially true
 * at the starting cell size, since the width formula already fills exactly that space, and still
 * true after a shrink, which is re-centred the same way. `cellAspect` is the target device's
 * screen aspect (width / height) — a mosaic cell has no device frame, but keeps a phone
 * screenshot's own shape so almost nothing is cropped.
 */
export function mosaicCells(layout: Layout, w: number, h: number, cellAspect: number, count: number): Box[] {
  if (count <= 0) return []
  const cols = count <= 4 ? 2 : 3
  const colOrder = cols === 2 ? [0, 1] : [0, 2, 1]
  const colOffsetFrac = cols === 2 ? [0, MOSAIC_COL2_OFFSET] : [0, MOSAIC_COL3_MID_OFFSET, 0]

  const marginX = w * MOSAIC_MARGIN_X
  const colGapX = w * MOSAIC_COL_GAP_X
  const rowGapY = h * MOSAIC_ROW_GAP_Y
  const gridTop = h * layout.device.top
  const rawCellW = (w - 2 * marginX - (cols - 1) * colGapX) / cols
  const rawCellH = rawCellW / cellAspect

  const cells: { col: number; row: number }[] = []
  const colCounts = new Array(cols).fill(0)
  for (let i = 0; i < count; i++) {
    const col = colOrder[i % cols]
    cells.push({ col, row: colCounts[col]++ })
  }

  // Shrink the cell just enough that its deepest instance — the last row of whichever column
  // staggers down the most — keeps at least MOSAIC_MIN_VISIBLE of its height on-canvas. A shallow
  // row's bound is always far above `rawCellH` and never binds; `Math.min` picks the one that does.
  const cellH = cells.reduce((maxH, { col, row }) => {
    const bound = (h - gridTop - row * rowGapY) / (colOffsetFrac[col] + row + MOSAIC_MIN_VISIBLE)
    return Math.min(maxH, bound)
  }, rawCellH)
  const cellW = cellH * cellAspect

  const contentW = cols * cellW + (cols - 1) * colGapX
  const left = marginX + (w - 2 * marginX - contentW) / 2
  const colX = Array.from({ length: cols }, (_, j) => left + j * (cellW + colGapX))

  return cells.map(({ col, row }) => ({
    x: colX[col],
    y: gridTop + colOffsetFrac[col] * cellH + row * (cellH + rowGapY),
    w: cellW,
    h: cellH,
  }))
}

/**
 * Draws the mosaic grid, tilted as one unit around its own centre by `settings.tilt` — the same
 * field a device band uses for its own angle, reused here since a mosaic tile has no device to
 * carry it. Cell `0` draws `sources.self`; an image that never loaded (or a cell past the last
 * named `extra`) still gets its white card, same as a device with no screenshot. Each card casts
 * `settings.deviceShadow` exactly like a device frame would (`drawDevice`) — a mosaic cell is a
 * frameless device in every way that matters to the shadow.
 */
function drawMosaicGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
  cellAspect: number,
  sources: SceneSources,
) {
  const count = 1 + (screen.extraIds?.length ?? 0)
  const boxes = mosaicCells(layout, w, h, cellAspect, count)
  if (!boxes.length) return
  const left = Math.min(...boxes.map((b) => b.x))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const top = Math.min(...boxes.map((b) => b.y))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  const pivotX = (left + right) / 2
  const pivotY = (top + bottom) / 2

  ctx.save()
  if (settings.tilt !== 0) {
    ctx.translate(pivotX, pivotY)
    ctx.rotate((settings.tilt * Math.PI) / 180)
    ctx.translate(-pivotX, -pivotY)
  }
  boxes.forEach((box, i) => {
    const img = i === 0 ? (sources.self ?? null) : (sources.extra?.[i - 1] ?? null)
    drawMosaicCell(ctx, box, img, settings.deviceShadow, settings.textColor)
  })
  ctx.restore()
}

/**
 * A shape's box is a square sized from its own `width` (a fraction of the tile width, the
 * diameter for a circle) — no image, so no aspect ratio to follow. A sticker's box instead
 * follows its image's own aspect ratio; with no known image it has no box at all, so it draws
 * nothing rather than guessing one. Never called for a chip — its box depends on measured text,
 * which needs the drawing context, so `drawChipElement` computes its own.
 */
function elementBox(
  el: StickerElement | ShapeElement,
  W: number,
  w: number,
  h: number,
  sources: SceneSources,
): Box | null {
  const dw = el.width * w
  if (isShapeElement(el)) return { x: el.x * W - dw / 2, y: el.y * h - dw / 2, w: dw, h: dw }
  const img = sources.elements?.[el.imageId]
  if (!img) return null
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
  if (!iw || !ih) return null
  const dh = (dw * ih) / iw
  return { x: el.x * W - dw / 2, y: el.y * h - dh / 2, w: dw, h: dh }
}

/**
 * A chip's box is not known up front: the pill hugs the (possibly auto-shrunk) text, so its width
 * and height only exist once the text is measured against `ctx`. `el.width` is the ceiling on the
 * pill's width (a fraction of the tile width, like every other element), never its actual size.
 */
function drawChipElement(
  ctx: CanvasRenderingContext2D,
  W: number,
  w: number,
  h: number,
  el: ChipElement,
  settings: Settings,
  lang: string | undefined,
) {
  if (!el.text) return
  const fit = fitChipText(ctx, el.text, settings, el.width * w, el.size * h, lang)
  const pillH = fit.size * CHIP_HEIGHT
  const padX = fit.size * CHIP_PAD_X
  const pillW = fit.textWidth + padX * 2
  const cx = el.x * W
  const cy = el.y * h
  const box: Box = { x: cx - pillW / 2, y: cy - pillH / 2, w: pillW, h: pillH }

  ctx.save()
  if (el.rotate !== 0) {
    ctx.translate(cx, cy)
    ctx.rotate((el.rotate * Math.PI) / 180)
    ctx.translate(-cx, -cy)
  }
  drawPill(ctx, box, el.color ?? settings.highlights[0] ?? '#ffffff', el.shadow)

  const rtl = isRtl(lang)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.fillStyle = el.textColor ?? settings.textColor
  const line: Line = { words: [{ text: el.text, span: -1 }], widths: [fit.textWidth], width: fit.textWidth }
  // Vertically centred the same way every other line is placed: `y` is the top of the em box,
  // `drawLine` puts the baseline `BASELINE` below it — never `ctx.textBaseline` (rules.md #3).
  drawLine(ctx, line, box.x + padX, box.y + (box.h - fit.size) / 2, fit.size, [], rtl)
  ctx.restore()
}

/**
 * Draws the elements of one layer — stickers, shapes and chips alike. `x`/`width` are fractions of
 * the composition width, `y` of the tile height (the layout convention).
 */
function drawElements(
  ctx: CanvasRenderingContext2D,
  W: number,
  w: number,
  h: number,
  elements: SceneElement[] | undefined,
  sources: SceneSources,
  layer: SceneElement['layer'],
  settings: Settings,
  lang: string | undefined,
) {
  if (!elements) return
  for (const el of elements) {
    if (el.layer !== layer) continue
    if (isChipElement(el)) {
      drawChipElement(ctx, W, w, h, el, settings, lang)
      continue
    }
    const box = elementBox(el, W, w, h, sources)
    if (!box) continue

    ctx.save()
    if (el.rotate !== 0) {
      ctx.translate(box.x + box.w / 2, box.y + box.h / 2)
      ctx.rotate((el.rotate * Math.PI) / 180)
      ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2))
    }
    if (isShapeElement(el)) drawShape(ctx, box, el.shape, el.color, el.stroke, el.seed)
    else drawSticker(ctx, box, sources.elements![el.imageId]!, el.shadow)
    ctx.restore()
  }
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

  // A backdrop is a card behind the device band; a deviceless layout has none to sit behind.
  if (settings.backdropColor && !layout.deviceless) drawBackdrop(ctx, W, w, h, layout, settings.backdropColor)
  drawElements(ctx, W, w, h, screen.elements, sources, 'behind', settings, screen.lang)
  drawTextBlock(ctx, W, w, h, layout, screen, settings)
  if (layout.list) {
    const capSize = headlineBaseSize(h, settings, layout.textScale) * LIST_CAP_MULT
    drawListBlock(ctx, W, w, h, layout, screen, settings, capSize)
  }

  const device = getDevice(settings.deviceId)

  if (layout.id === 'mosaic') {
    drawMosaicGrid(ctx, w, h, layout, screen, settings, device.screenAspect, sources)
  } else {
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

    // An artwork screen has no source screenshot at all — self/next/prev would draw an empty
    // device body. Only a placement that draws the slot's own frameless artwork applies to it.
    const isArtworkScreen = screen.kind === 'artwork'
    for (const { box, source, angle, frameless } of boxes) {
      if (isArtworkScreen && source !== 'artwork') continue
      // A multi-device arrangement falls back to the current screenshot when there is no
      // neighbour, so a single-screen project still renders every frame. Artwork gets no such
      // fallback: an unframed screenshot in that slot would be wrong, not merely a stand-in.
      const img = source === 'artwork' ? (sources.artwork ?? null) : (sources[source] ?? sources.self ?? null)
      if (!img && (frameless || source === 'artwork')) continue

      ctx.save()
      if (angle !== 0) {
        ctx.translate(box.x + box.w / 2, box.y + box.h / 2)
        ctx.rotate((angle * Math.PI) / 180)
        ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2))
      }
      if (frameless) drawArtwork(ctx, box, img!)
      else drawDevice(ctx, box, device, color, img, settings.deviceShadow, settings.textColor)
      ctx.restore()
    }
  }

  drawElements(ctx, W, w, h, screen.elements, sources, 'front', settings, screen.lang)
}
