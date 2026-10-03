import type { ExportSize } from '../types'

/** Only the largest device in each family is required — the stores downscale for the rest. */
export const EXPORT_SIZES: ExportSize[] = [
  { id: 'iphone-6-9', label: 'iPhone 6.9"', store: 'App Store', w: 1320, h: 2868 },
  { id: 'iphone-6-5', label: 'iPhone 6.5"', store: 'App Store', w: 1242, h: 2688 },
  { id: 'ipad-13', label: 'iPad 13"', store: 'App Store', w: 2064, h: 2752 },
  { id: 'android-phone', label: 'Android phone', store: 'Google Play', w: 1080, h: 1920 },
  { id: 'android-phone-tall', label: 'Android phone (tall)', store: 'Google Play', w: 1080, h: 2400 },
  { id: 'android-tablet', label: 'Android tablet', store: 'Google Play', w: 1600, h: 2560 },
  { id: 'play-feature-graphic', label: 'Play feature graphic', store: 'Google Play', w: 1024, h: 500 },
  { id: 'studio-4x5', label: 'Portrait 4:5', store: 'Studio', w: 1080, h: 1350 },
  { id: 'studio-square', label: 'Square 1:1', store: 'Studio', w: 1080, h: 1080 },
  { id: 'studio-16x9', label: 'Landscape 16:9', store: 'Studio', w: 1920, h: 1080 },
  { id: 'open-graph', label: 'Open Graph', store: 'Studio', w: 1200, h: 630 },
  { id: 'story', label: 'Story 9:16', store: 'Studio', w: 1080, h: 1920 },
]

export const getSize = (id: string): ExportSize => EXPORT_SIZES.find((s) => s.id === id) ?? EXPORT_SIZES[0]
