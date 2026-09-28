import { scriptFontFor } from './scripts'

/**
 * The renderer's four base-Latin glyph groups, checked against each face's actual cmap (see
 * `resolveFontId` in `scripts.ts`). CJK, Thai and Arabic never consult this — they get a Noto
 * face from `scriptFontFor` regardless of which group their language would otherwise fall in.
 */
export type LangGroup = 'latin' | 'latin-ext' | 'cyrillic' | 'vietnamese'

export type FontOption = {
  id: string
  label: string
  /** Family name as the browser knows it; '' means fall back to the system stack. */
  family: string
  stack: string
  /** Groups the face can draw. A language outside this list is redrawn in Inter instead. */
  coverage: LangGroup[]
}

const SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const ALL_GROUPS: LangGroup[] = ['latin', 'latin-ext', 'cyrillic', 'vietnamese']

export const FONTS: FontOption[] = [
  {
    id: 'inter',
    label: 'Inter',
    family: 'Inter Variable',
    stack: `"Inter Variable", "Inter", ${SYSTEM}`,
    coverage: ALL_GROUPS,
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    family: 'DM Sans Variable',
    stack: `"DM Sans Variable", ${SYSTEM}`,
    coverage: ['latin', 'latin-ext'],
  },
  {
    id: 'poppins',
    label: 'Poppins',
    family: 'Poppins',
    stack: `"Poppins", ${SYSTEM}`,
    coverage: ['latin', 'latin-ext'],
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: 'Space Grotesk Variable',
    stack: `"Space Grotesk Variable", ${SYSTEM}`,
    coverage: ['latin', 'latin-ext', 'vietnamese'],
  },
  {
    id: 'playfair',
    label: 'Playfair Display',
    family: 'Playfair Display Variable',
    stack: `"Playfair Display Variable", Georgia, serif`,
    coverage: ALL_GROUPS,
  },
  {
    id: 'baloo-2',
    label: 'Baloo 2',
    family: 'Baloo 2',
    stack: `"Baloo 2", ${SYSTEM}`,
    // No Cyrillic in the upstream face (verified against the TTF's cmap, not the family's reputation).
    coverage: ['latin', 'latin-ext', 'vietnamese'],
  },
  {
    id: 'nunito',
    label: 'Nunito',
    family: 'Nunito',
    stack: `"Nunito", ${SYSTEM}`,
    coverage: ALL_GROUPS,
  },
  // The OS picks the face itself, so there is no bundled cmap to fall short — never redirected.
  { id: 'system', label: 'System', family: '', stack: SYSTEM, coverage: ALL_GROUPS },
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
    // 600 is a real weight for the label subhead (`setLabelSubFont` in `render/text.ts`) on
    // every family that has one to load — a static Regular/Bold face just resolves 600→700
    // there and this load is a harmless no-op for it.
    for (const weight of [400, 600, 700]) {
      jobs.push(document.fonts.load(`${weight} 64px "${font.family}"`).catch(() => undefined))
    }
  }
  await Promise.all(jobs)
  await document.fonts.ready
}

/** Script fonts are ~8 MB each; only the families a project's languages need are fetched. */
export async function preloadScriptFonts(langs: string[]): Promise<void> {
  const families = new Set(langs.map((l) => scriptFontFor(l)?.family).filter((f): f is string => !!f))
  await Promise.all(
    [...families].flatMap((family) =>
      [400, 600, 700].map((weight) =>
        document.fonts.load(`${weight} 64px "${family}"`).catch(() => undefined),
      ),
    ),
  )
  await document.fonts.ready
  // A face that is not available now would render in the system font without any error; the
  // renderer treats that as a defect (rules.md, rule 3), so the load fails loudly instead.
  const missing = [...families].filter((family) => !document.fonts.check(`400 64px "${family}"`))
  if (missing.length) throw new Error(`Script fonts not available: ${missing.join(', ')}`)
}
