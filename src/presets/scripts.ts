import { getFont } from './fonts'

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

export function fontStackFor(fontId: string, lang: string | undefined): string {
  const base = getFont(fontId).stack
  const script = scriptFontFor(lang)
  return script ? `"${script.family}", ${base}` : base
}
