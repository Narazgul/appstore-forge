import type { DeviceSpec, FrameColor } from '../types'

/**
 * Screen aspects are the real panel ratios; bezel/radius are fractions of the outer frame
 * width, tuned so each family reads as itself — Pixels rounder, Samsungs squarer and thinner.
 */
// prettier-ignore
export const DEVICES: DeviceSpec[] = [
  // iOS
  { id: 'iphone-17-pro', label: 'iPhone 17 Pro', group: 'iPhone', screenAspect: 1320 / 2868, bezel: 0.030, radius: 0.150, notch: 'island' },
  { id: 'iphone-17', label: 'iPhone 17', group: 'iPhone', screenAspect: 1206 / 2622, bezel: 0.032, radius: 0.150, notch: 'island' },
  { id: 'iphone-se', label: 'iPhone SE', group: 'iPhone', screenAspect: 750 / 1334, bezel: 0.045, radius: 0.095, notch: 'none' },
  { id: 'ipad-13', label: 'iPad Pro 13"', group: 'iPad', screenAspect: 2064 / 2752, bezel: 0.026, radius: 0.055, notch: 'none' },

  // Android
  { id: 'pixel-9-pro', label: 'Pixel 9 Pro', group: 'Android', screenAspect: 1280 / 2856, bezel: 0.026, radius: 0.085, notch: 'punch' },
  { id: 'pixel-9-pro-xl', label: 'Pixel 9 Pro XL', group: 'Android', screenAspect: 1344 / 2992, bezel: 0.025, radius: 0.085, notch: 'punch' },
  { id: 'pixel-8a', label: 'Pixel 8a', group: 'Android', screenAspect: 1080 / 2400, bezel: 0.040, radius: 0.075, notch: 'punch' },
  { id: 'galaxy-s25-ultra', label: 'Galaxy S25 Ultra', group: 'Android', screenAspect: 1440 / 3120, bezel: 0.022, radius: 0.045, notch: 'punch' },
  { id: 'galaxy-s25', label: 'Galaxy S25', group: 'Android', screenAspect: 1080 / 2340, bezel: 0.026, radius: 0.090, notch: 'punch' },
  { id: 'galaxy-a56', label: 'Galaxy A56', group: 'Android', screenAspect: 1080 / 2340, bezel: 0.038, radius: 0.080, notch: 'punch' },
  { id: 'android-tablet', label: 'Android tablet', group: 'Android', screenAspect: 1600 / 2560, bezel: 0.030, radius: 0.050, notch: 'none' },

  { id: 'browser', label: 'Browser window', group: 'Other', screenAspect: 1440 / 900, bezel: 0, radius: 0.012, notch: 'none', toolbar: 0.05 },
  { id: 'none', label: 'No frame', group: 'Other', screenAspect: 1320 / 2868, bezel: 0, radius: 0.045, notch: 'none' },
]

export const DEVICE_GROUPS = ['iPhone', 'iPad', 'Android', 'Other'] as const

export const FRAME_COLORS: FrameColor[] = [
  { id: 'deep-blue', label: 'Deep Blue', body: '#28344a', edge: '#5b6b88' },
  { id: 'black', label: 'Black', body: '#1c1c1e', edge: '#4a4a4e' },
  { id: 'silver', label: 'Silver', body: '#c9ccd2', edge: '#f2f3f5' },
  { id: 'gold', label: 'Desert Gold', body: '#bda182', edge: '#e8d6be' },
  { id: 'porcelain', label: 'Porcelain', body: '#e8e4dc', edge: '#fbf9f5' },
  { id: 'mint', label: 'Mint', body: '#9fb8a8', edge: '#cfe0d5' },
]

/** Outer frame aspect ratio, derived from the screen aspect plus the bezel on all four sides. */
export function frameAspect(d: DeviceSpec): number {
  const screenW = 1 - 2 * d.bezel
  const screenH = screenW / d.screenAspect
  return 1 / (screenH + 2 * d.bezel + (d.toolbar ?? 0))
}

export const getDevice = (id: string): DeviceSpec => DEVICES.find((d) => d.id === id) ?? DEVICES[0]
export const getFrameColor = (id: string): FrameColor =>
  FRAME_COLORS.find((c) => c.id === id) ?? FRAME_COLORS[0]
