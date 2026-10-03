import { getLayout } from '../presets/layouts'
import { getSize } from '../presets/sizes'
import { sceneSpan } from '../render/scene'
import { effectiveSettings } from './settings'
import type { Screen, Settings } from '../types'

/** Store rules that decide whether a set can upload at all. */
const LIMITS = {
  'App Store': { min: 1, max: 10 },
  'Google Play': { min: 2, max: 8 },
  // No store behind it: any count of pictures is fine.
  Studio: { min: 1, max: Infinity },
} as const

export type Readiness = {
  total: number
  filled: number
  /** slots still without a screenshot */
  missingShots: number
  /** screens whose layout shows copy but have no headline */
  missingCopy: number
  tiles: number
  store: keyof typeof LIMITS
  limit: { min: number; max: number }
  /** more tiles than the store accepts */
  overLimit: boolean
  /** fewer tiles than the store accepts */
  underMin: boolean
  /** everything the export needs; copy and store limits are advice, not gates */
  canExport: boolean
}

/** One reading of "how far along is this set", shared by the rail, the footer and the review. */
export function readiness(screens: Screen[], settings: Settings): Readiness {
  const total = screens.length
  // An artwork-kind screen has no source screenshot to fill — it is never "missing" one.
  const filled = screens.filter((s) => s.imageId !== null || s.kind === 'artwork').length
  const missingCopy = screens.filter((s) => {
    const layout = getLayout(effectiveSettings(s, settings).layout)
    return layout.text !== null && !s.headline.trim()
  }).length
  const tiles = screens.reduce((n, s) => n + sceneSpan(s, settings), 0)
  const store = getSize(settings.sizeId).store
  const limit = LIMITS[store]
  return {
    total,
    filled,
    missingShots: total - filled,
    missingCopy,
    tiles,
    store,
    limit,
    overLimit: tiles > limit.max,
    underMin: total > 0 && tiles < limit.min,
    canExport: total > 0 && filled === total,
  }
}
