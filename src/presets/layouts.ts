import type { Layout, LayoutId } from '../types'

/** Where the text band and the device band sit vertically. Fractions of canvas height. */
// prettier-ignore
export const LAYOUTS: Layout[] = [
  { id: 'text-top', label: 'Text above', span: 1, text: { top: 0.065, height: 0.165 }, device: { top: 0.27, bottom: 0.95 }, padX: 0.09 },
  { id: 'text-bottom', label: 'Text below', span: 1, text: { top: 0.76, height: 0.165 }, device: { top: 0.06, bottom: 0.72 }, padX: 0.09 },
  { id: 'bleed', label: 'Bleed off edge', span: 1, text: { top: 0.07, height: 0.175 }, device: { top: 0.29, bottom: 1.14 }, padX: 0.07 },
  // Room for a three-line display headline; the device sits low and runs off the bottom.
  { id: 'editorial', label: 'Tall text', span: 1, text: { top: 0.07, height: 0.25 }, device: { top: 0.41, bottom: 1.12 }, padX: 0.085 },
  // A large device, 95% of the tile wide, running off the bottom.
  { id: 'hero', label: 'Hero', span: 1, text: { top: 0.06, height: 0.22 }, device: { top: 0.3, bottom: 1.3, width: 0.95, cy: 0.75 }, padX: 0.09 },
  // Room for two devices side by side (use the Duo arrangements).
  { id: 'duo', label: 'Duo', span: 1, text: { top: 0.06, height: 0.22 }, device: { top: 0.3, bottom: 1.25, width: 0.7, cy: 0.74 }, padX: 0.09 },
  // Two store tiles: copy on the left tile, one big device across the seam.
  // The device leans away from the copy (top to the right), so its top-left corner clears the text box.
  { id: 'panorama', label: 'Panorama', span: 2, text: { top: 0.07, height: 0.3, left: 0.045, width: 0.36 }, device: { top: 0.3, bottom: 1.3, width: 1.05, cx: 0.6, cy: 0.74 }, padX: 0.09 },
  // Two store tiles sharing one headline, a device on each side (use the Wings arrangement).
  { id: 'panorama-duo', label: 'Panorama duo', span: 2, text: { top: 0.06, height: 0.22, left: 0.1, width: 0.8 }, device: { top: 0.3, bottom: 1.25, width: 0.8, cy: 0.72 }, padX: 0.09 },
  { id: 'centered', label: 'Device only', span: 1, text: null, device: { top: 0.07, bottom: 0.93 }, padX: 0.1 },
  // Landscape banners (Play feature graphic): text fills its half, vertically centred, at a
  // multiplier bold enough to read on a short, wide tile. No device is drawn for an artwork slot,
  // so `device` here is unused geometry, not a real band — kept only because the type requires one.
  {
    id: 'banner-left',
    label: 'Banner, text left',
    span: 1,
    text: { top: 0.069, height: 0.84, left: 0.055, width: 0.4 },
    device: { top: 0.9, bottom: 1.05 },
    padX: 0.06,
    textScale: 5,
  },
  {
    id: 'banner-right',
    label: 'Banner, text right',
    span: 1,
    text: { top: 0.069, height: 0.84, left: 0.545, width: 0.4 },
    device: { top: 0.9, bottom: 1.05 },
    padX: 0.06,
    textScale: 5,
  },
  // No device at all — a set willing to break the "handset parade" for one tile. The text band
  // is the whole tile height; `availableTextHeight` grows the block up to it instead of stopping
  // at a device band that does not exist. `device` here is unused geometry, kept only because the
  // type requires one.
  {
    id: 'text-only',
    label: 'Text only',
    span: 1,
    text: { top: 0.12, height: 0.76 },
    device: { top: 0.9, bottom: 1.05 },
    padX: 0.09,
    textScale: 2,
    deviceless: true,
  },
  // A closing tile: the ordinary headline band up top, a big keyword list filling the rest.
  {
    id: 'feature-wall',
    label: 'Feature wall',
    span: 1,
    text: { top: 0.065, height: 0.2 },
    list: { top: 0.3, height: 0.5 },
    device: { top: 0.9, bottom: 1.05 },
    padX: 0.09,
    deviceless: true,
  },
  // An overview tile: 4–6 rahmenlose mini-screens (Screen.extraIds) in a staggered grid,
  // `mosaicCells` in render/scene.ts (its own margins, not `padX`, size and place the cells;
  // `padX` here still positions the text band, same as any other layout). No device is ever
  // drawn for it — `device.top` only marks where the grid starts, right under the text band
  // (the rule-4 shrink gate also reads it), `device.bottom` is unused.
  {
    id: 'mosaic',
    label: 'Mosaic',
    span: 1,
    text: { top: 0.065, height: 0.165 },
    device: { top: 0.255, bottom: 1.3 },
    padX: 0.07,
  },
  // Landscape studio formats (16:9, Open Graph): copy fills one side, the device stands upright on
  // the other. Text and device bands start at the same height, so neither lifts nor shrinks the other.
  {
    id: 'landscape-left',
    label: 'Landscape, text left',
    span: 1,
    text: { top: 0.08, height: 0.84, left: 0.06, width: 0.46 },
    device: { top: 0.08, bottom: 0.92, cx: 0.76 },
    padX: 0.06,
    textScale: 2,
    textColumn: true,
  },
  {
    id: 'landscape-right',
    label: 'Landscape, text right',
    span: 1,
    text: { top: 0.08, height: 0.84, left: 0.48, width: 0.46 },
    device: { top: 0.08, bottom: 0.92, cx: 0.24 },
    padX: 0.06,
    textScale: 2,
    textColumn: true,
  },
  // Headline across the top, the device centred below it and running off the bottom edge.
  {
    id: 'landscape-center',
    label: 'Landscape, device centre',
    span: 1,
    text: { top: 0.06, height: 0.2 },
    device: { top: 0.31, bottom: 1.12 },
    padX: 0.12,
    textScale: 1.6,
  },
]

export const getLayout = (id: LayoutId): Layout => LAYOUTS.find((t) => t.id === id) ?? LAYOUTS[0]
