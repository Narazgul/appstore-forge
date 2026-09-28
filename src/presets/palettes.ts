import { AA_NORMAL_TEXT, contrastRatio, mix } from '../lib/contrast'
import type { Palette, PaletteColors } from '../types'

/**
 * Colour values ported from ParthJadhav/app-store-screenshots (MIT) — see NOTICE. Each row is
 * `id, label, background, backgroundAlt, textColor, textColorAlt, accent, accentAlt?`; a missing
 * `accentAlt` means the source names only one accent and the alt pair's eyebrow falls back to it.
 */
type RawEntry = readonly [
  id: string,
  label: string,
  bg: string,
  bgAlt: string,
  fg: string,
  fgAlt: string,
  accent: string,
  accentAlt?: string,
]

const RAW: RawEntry[] = [
  ['clean-light', 'Clean Light', '#F6F1EA', '#171717', '#171717', '#F6F1EA', '#5B7CFA'],
  ['dark-bold', 'Dark Bold', '#0B1020', '#F8FAFC', '#F8FAFC', '#0B1020', '#8B5CF6'],
  ['warm-editorial', 'Warm Editorial', '#F7E8DA', '#2B1D17', '#2B1D17', '#F7E8DA', '#D97706'],
  ['ocean-fresh', 'Ocean Fresh', '#E0F2FE', '#0C4A6E', '#0C4A6E', '#E0F2FE', '#0284C7'],
  ['bloom-roast', 'Bloom Roast', '#F2ECE2', '#24352F', '#1D2420', '#FFF7EA', '#B8794A'],
  [
    'hand-drawn-editorial',
    'Hand-Drawn Editorial',
    '#F5EFDF',
    '#1B2336',
    '#1B2336',
    '#F5EFDF',
    '#B53A24',
    '#F26A50',
  ],
  ['retro-rubberhose', 'Retro Rubberhose', '#F4E6CC', '#5C3A1E', '#2A2118', '#F4E6CC', '#B23A2A', '#F2BB46'],
  ['moody-curated', 'Moody Curated', '#1F1C1A', '#F4EBDD', '#F4EBDD', '#1F1C1A', '#E8B97A', '#7A4F2A'],
  ['paper-sticker', 'Paper Sticker', '#F8F0E2', '#8FBE7C', '#1F2A44', '#1F2A44', '#2B6CB0', '#1E3F7A'],
  ['dreamy-pastel', 'Dreamy Pastel', '#F5E0F0', '#1B2240', '#1B2240', '#F5E0F0', '#5B3FC8', '#C9B6F2'],
  ['glossy-3d', 'Glossy 3D', '#3B266B', '#F4EEFB', '#FFFFFF', '#3B266B', '#FBE254', '#7B3FD0'],
  [
    'liquid-glass-aurora',
    'Liquid Glass Aurora',
    '#F4F1FB',
    '#1B1730',
    '#16131F',
    '#F4F1FB',
    '#4A2FC0',
    '#B9A8FF',
  ],
  ['swiss-grid-bold', 'Swiss Grid Bold', '#F2F1EC', '#0E0E0C', '#0E0E0C', '#F2F1EC', '#C23B00', '#FF4F00'],
  [
    'neon-athletic-night',
    'Neon Athletic Night',
    '#0A0B0D',
    '#D4FF3A',
    '#F4F5F0',
    '#0A0B0D',
    '#D4FF3A',
    '#0A0B0D',
  ],
  ['magazine-cover', 'Magazine Cover', '#F1EBE1', '#7A2320', '#1A1714', '#F6EFE3', '#7A2320', '#F1D9C9'],
  ['candy-pop-social', 'Candy Pop Social', '#C6F135', '#2B44F0', '#16121F', '#FFFFFF', '#2B44F0', '#FFE23D'],
  [
    'soft-clay-wellness',
    'Soft Clay Wellness',
    '#EFE7DA',
    '#3A2B3A',
    '#3A2E27',
    '#F3EBDD',
    '#9A4B31',
    '#E6A585',
  ],
  [
    'midnight-glow-pro',
    'Midnight Glow Pro',
    '#07080B',
    '#F4F5F8',
    '#F4F5F8',
    '#0B0C12',
    '#B3AFFF',
    '#3B38C8',
  ],
  ['risograph-zine', 'Risograph Zine', '#F4F0E6', '#321871', '#3255A4', '#F4F0E6', '#C8006A', '#FF8FD0'],
  ['bento-keynote', 'Bento Keynote', '#F5F5F7', '#1D1D1F', '#1D1D1F', '#F5F5F7', '#B4441C', '#FF9F6B'],
  ['toybox-primary', 'Toybox Primary', '#FFF6E6', '#3FA9F5', '#1F1A4D', '#1F1A4D', '#6236D9', '#1F1A4D'],
  ['quiet-japandi', 'Quiet Japandi', '#F3F0EA', '#1E1D1B', '#1E1D1B', '#F3F0EA', '#C8321E', '#E8836F'],
  [
    'vintage-travel-poster',
    'Vintage Travel Poster',
    '#4B2E4F',
    '#F1E4C8',
    '#F1E4C8',
    '#1C1A17',
    '#E8B04A',
    '#A8401C',
  ],
]

const TINT_STEPS = 40

/**
 * The lightest touch of `background` mixed into `hue` that still lets `textColor` reach
 * `AA_NORMAL_TEXT` on it — the most saturated legible marker band. `null` when even the
 * background itself (t = 1) does not clear the bar, i.e. `textColor` on `background` already
 * fails AA on its own.
 */
function accessibleTint(hue: string, background: string, textColor: string): string | null {
  for (let i = 0; i <= TINT_STEPS; i++) {
    const candidate = mix(hue, background, i / TINT_STEPS)
    if (contrastRatio(textColor, candidate) >= AA_NORMAL_TEXT) return candidate
  }
  return null
}

/** Up to two marker-band colours for one pair, one per distinct hue that clears the bar. */
function highlightsFor(background: string, textColor: string, hues: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const hue of hues) {
    if (seen.has(hue)) continue
    seen.add(hue)
    const tinted = accessibleTint(hue, background, textColor)
    if (tinted) out.push(tinted)
  }
  // A palette whose base pair already fails AA has no accessible tint to fall back to; keeping
  // the array non-empty matters more here than the fallback being pretty — `highlights[span %
  // highlights.length]` in render/text.ts must never divide by zero.
  return out.length ? out : [background]
}

/** The eyebrow is small text, so an accent too faint on its background is pulled toward the text colour. */
function readableAccent(accent: string, background: string, textColor: string): string {
  for (let i = 0; i <= TINT_STEPS; i++) {
    const candidate = mix(accent, textColor, i / TINT_STEPS)
    if (contrastRatio(candidate, background) >= AA_NORMAL_TEXT) return candidate
  }
  return textColor
}

function pair(background: string, textColor: string, accent: string, hues: string[]): PaletteColors {
  return {
    background: { kind: 'solid', color: background },
    textColor,
    eyebrowColor: readableAccent(accent, background, textColor),
    highlights: highlightsFor(background, textColor, hues),
  }
}

export const PALETTES: Palette[] = RAW.map(([id, label, bg, bgAlt, fg, fgAlt, accent, accentAlt]) => ({
  id,
  label,
  colors: pair(bg, fg, accent, accentAlt ? [accent, accentAlt] : [accent]),
  alt: pair(bgAlt, fgAlt, accentAlt ?? accent, accentAlt ? [accentAlt, accent] : [accent]),
}))

export const getPalette = (id: string): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0]
