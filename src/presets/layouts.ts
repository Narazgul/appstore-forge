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
    text: { top: 0.08, height: 0.84, left: 0.06, width: 0.4 },
    device: { top: 0.9, bottom: 1.05 },
    padX: 0.06,
    textScale: 5,
  },
  {
    id: 'banner-right',
    label: 'Banner, text right',
    span: 1,
    text: { top: 0.08, height: 0.84, left: 0.54, width: 0.4 },
    device: { top: 0.9, bottom: 1.05 },
    padX: 0.06,
    textScale: 5,
  },
]

export const getLayout = (id: LayoutId): Layout => LAYOUTS.find((t) => t.id === id) ?? LAYOUTS[0]
