import type { Background, OptionalSettingKey, ScreenOverrides, Settings } from '../../types'

/**
 * Every tune section reads the *resolved* settings for the active scope and writes back
 * through `put`, which the panel points at either the selected screen's overrides or the
 * global settings. A section never needs to know which scope it is editing.
 */
export type SectionProps = {
  settings: Settings
  put: (patch: ScreenOverrides) => void
  /** whether the active scope itself sets `key` (rather than inheriting or leaving it absent) */
  owns?: (key: OptionalSettingKey) => boolean
  /** drops `key` from the active scope — the screen's override, or the set-wide value */
  clear?: (key: OptionalSettingKey) => void
}

export const gradientCss = (g: Extract<Background, { kind: 'gradient' }>) =>
  `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`
