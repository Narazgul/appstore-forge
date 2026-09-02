import { SCRIPT_FONTS } from './scripts'

export type FontOption = {
  id: string
  label: string
  /** Family name as the browser knows it; '' means fall back to the system stack. */
  family: string
  stack: string
}

const SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

export const FONTS: FontOption[] = [
  { id: 'inter', label: 'Inter', family: 'Inter Variable', stack: `"Inter Variable", "Inter", ${SYSTEM}` },
  { id: 'dm-sans', label: 'DM Sans', family: 'DM Sans Variable', stack: `"DM Sans Variable", ${SYSTEM}` },
  { id: 'poppins', label: 'Poppins', family: 'Poppins', stack: `"Poppins", ${SYSTEM}` },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: 'Space Grotesk Variable',
    stack: `"Space Grotesk Variable", ${SYSTEM}`,
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    family: 'Playfair Display Variable',
    stack: `"Playfair Display Variable", Georgia, serif`,
  },
  { id: 'system', label: 'System', family: '', stack: SYSTEM },
]

export const getFont = (id: string): FontOption => FONTS.find((f) => f.id === id) ?? FONTS[0]

/**
 * Canvas does not trigger a webfont download the way DOM text does — `ctx.font` silently
 * falls back if the face has not been fetched yet. Every family must be explicitly loaded
 * at the weights the renderer uses, or exports come out in the fallback font.
 */
export async function preloadFonts(): Promise<void> {
  const jobs: Promise<unknown>[] = []
  for (const font of FONTS) {
    if (!font.family) continue
    for (const weight of [400, 700]) {
      jobs.push(document.fonts.load(`${weight} 64px "${font.family}"`).catch(() => undefined))
    }
  }
  for (const font of SCRIPT_FONTS) {
    for (const weight of [400, 700]) {
      jobs.push(document.fonts.load(`${weight} 64px "${font.family}"`).catch(() => undefined))
    }
  }
  await Promise.all(jobs)
  await document.fonts.ready
}
