import type { OptionalSettingKey, OverridableKey, Screen, Settings } from '../types'

/**
 * A screen's own values win; everything else falls through to the global settings. Then, if the
 * result is `inverted` and carries an `altColors` pair, the four colour keys are swapped for it —
 * unless the screen itself named one of those keys explicitly, which still wins. Order is exactly
 * global → alt pair → explicit screen override.
 */
export function effectiveSettings(screen: Screen, settings: Settings): Settings {
  const merged = { ...settings, ...screen.overrides }
  if (!merged.inverted || !merged.altColors) return merged
  const alt = merged.altColors
  const ov = screen.overrides
  return {
    ...merged,
    background: ov.background !== undefined ? ov.background : alt.background,
    textColor: ov.textColor !== undefined ? ov.textColor : alt.textColor,
    eyebrowColor: ov.eyebrowColor !== undefined ? ov.eyebrowColor : alt.eyebrowColor,
    highlights: ov.highlights !== undefined ? ov.highlights : alt.highlights,
  }
}

export const isOverridden = (screen: Screen | null, key: OverridableKey): boolean =>
  screen ? screen.overrides[key] !== undefined : false

/** Which controls belong to which sidebar section, for the per-section reset affordance. */
export const SECTION_KEYS: Record<string, OverridableKey[]> = {
  background: ['background', 'backdropColor', 'altColors', 'inverted'],
  device: ['deviceId', 'frameColorId', 'deviceShadow', 'browserUrl', 'backBlur', 'deviceFade'],
  layout: ['layout', 'positionId'],
  type: [
    'fontId',
    'headlineScale',
    'subheadScale',
    'headlineTracking',
    'textColor',
    'eyebrowColor',
    'textAlign',
    'highlights',
    'accentBar',
    'subheadStyle',
    'textOffset',
  ],
  adjust: ['tilt', 'deviceScale', 'deviceOffset'],
}

/** The overridable keys `DEFAULT_SETTINGS` has no entry for — see `OptionalSettingKey`. */
export const OPTIONAL_SETTING_KEYS: OptionalSettingKey[] = [
  'deviceOffset',
  'textOffset',
  'browserUrl',
  'backBlur',
  'deviceFade',
]
