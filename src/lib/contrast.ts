import type { Background } from '../types'

export type RGB = { r: number; g: number; b: number }

const clampByte = (n: number) => Math.min(255, Math.max(0, Math.round(n)))

/** Accepts `#rgb` or `#rrggbb`, with or without the leading `#`. */
export function parseHexColor(hex: string): RGB {
  const clean = hex.trim().replace(/^#/, '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a hex colour: ${hex}`)
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function toHexColor({ r, g, b }: RGB): string {
  const c = (v: number) => clampByte(v).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function channelLuminance(byte: number): number {
  const s = byte / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/** WCAG 2 contrast ratio, 1 (identical) to 21 (black on white). Argument order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Linear interpolation per channel in sRGB space; `t = 0` is `a`, `t = 1` is `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHexColor(a)
  const cb = parseHexColor(b)
  return toHexColor({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  })
}

/** `fg` painted at `alpha` over `bg` — how the subhead actually reads: `drawTextBlock` in
 *  `render/text.ts` sets `ctx.globalAlpha = 0.72` for it and never paints it fully opaque. */
export function blendOverBackground(fg: string, alpha: number, bg: string): string {
  return mix(bg, fg, alpha)
}

/** WCAG 2's minimum ratio for large-scale text; below it a pairing is not legible enough to ship. */
export const AA_LARGE_TEXT = 3
/** WCAG 2's ratio for normal text; between this and `AA_LARGE_TEXT` a pairing clears the low bar
 *  but not this one. */
export const AA_NORMAL_TEXT = 4.5

/**
 * `fg` against a background that may be a gradient — the worse of the two stops, since a real
 * render can put the text over either end. `alpha < 1` blends `fg` into each stop first, for text
 * drawn translucent (the subhead).
 */
export function contrastAgainstBackground(fg: string, background: Background, alpha = 1): number {
  const stops = background.kind === 'solid' ? [background.color] : [background.from, background.to]
  return contrastAgainstColors(fg, stops, alpha)
}

/** `fg` against the worst of several colours it may sit on — the stops of a gradient, or the mean
 *  colour of a background image behind the text block in each locale and target. */
export function contrastAgainstColors(fg: string, colors: string[], alpha = 1): number {
  return Math.min(
    ...colors.map((color) => contrastRatio(alpha < 1 ? blendOverBackground(fg, alpha, color) : fg, color)),
  )
}
