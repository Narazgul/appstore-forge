import { getFont, type LangGroup } from './fonts'

export type ScriptFont = { family: string; file: string; test: (lang: string) => boolean }

const starts =
  (...prefixes: string[]) =>
  (lang: string) =>
    prefixes.some((p) => lang === p || lang.startsWith(`${p}-`))

/** Inter covers Latin, Cyrillic, Greek and Vietnamese; everything else needs its Noto face. */
export const SCRIPT_FONTS: ScriptFont[] = [
  { family: 'Noto Sans Arabic', file: 'NotoSansArabic.ttf', test: starts('ar', 'fa', 'ur') },
  { family: 'Noto Sans Thai', file: 'NotoSansThai.ttf', test: starts('th') },
  {
    family: 'Noto Sans TC',
    file: 'NotoSansTC.ttf',
    test: (l) => l.startsWith('zh-Hant') || starts('zh-TW', 'zh-HK', 'zh-MO')(l),
  },
  { family: 'Noto Sans SC', file: 'NotoSansSC.ttf', test: starts('zh') },
  { family: 'Noto Sans KR', file: 'NotoSansKR.ttf', test: starts('ko') },
  { family: 'Noto Sans JP', file: 'NotoSansJP.ttf', test: starts('ja') },
]

export const scriptFontFor = (lang: string | undefined): ScriptFont | null =>
  lang ? (SCRIPT_FONTS.find((f) => f.test(lang)) ?? null) : null

/** Hebrew is detected here but has no bundled face; `he` falls back to the system font. */
export const isRtl = (lang: string | undefined): boolean => !!lang && starts('ar', 'he', 'fa', 'ur')(lang)

const isCyrillic = starts('ru')
const isVietnamese = starts('vi')
const isLatinExt = starts('pl', 'tr')

/**
 * Which of `FontOption.coverage`'s groups a language needs from the *base* Latin font. Only
 * meaningful for languages that are not already redirected to a script font (below) — Polish
 * and Turkish share 'latin-ext' because both need Latin Extended-A, not because they are
 * otherwise related.
 */
export function languageGroupFor(lang: string | undefined): LangGroup {
  if (!lang) return 'latin'
  if (isCyrillic(lang)) return 'cyrillic'
  if (isVietnamese(lang)) return 'vietnamese'
  if (isLatinExt(lang)) return 'latin-ext'
  return 'latin'
}

/**
 * The font id the renderer actually draws with. A script language ignores this entirely (its
 * glyphs come from the Noto face); everything else falls back to Inter when the chosen face's
 * cmap does not cover the language — deterministically, so the GUI and the CLI never disagree
 * on which glyph shows up.
 */
export function resolveFontId(fontId: string, lang: string | undefined): string {
  if (scriptFontFor(lang)) return fontId
  return getFont(fontId).coverage.includes(languageGroupFor(lang)) ? fontId : 'inter'
}

export function fontStackFor(fontId: string, lang: string | undefined): string {
  const base = getFont(resolveFontId(fontId, lang)).stack
  const script = scriptFontFor(lang)
  return script ? `"${script.family}", ${base}` : base
}
