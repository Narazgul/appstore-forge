import type { ProjectLocale } from './types'

/** Regions for ids that name none. The flag is the only place a region shows, so every id needs one. */
const FALLBACK_REGION: Record<string, string> = {
  en: 'US',
  de: 'DE',
  zh: 'CN',
  'zh-Hans': 'CN',
  'zh-TW': 'TW',
  'zh-Hant': 'TW',
  ko: 'KR',
  ja: 'JP',
  ar: 'SA',
  th: 'TH',
  vi: 'VN',
  ru: 'RU',
  he: 'IL',
  fa: 'IR',
  ur: 'PK',
  id: 'ID',
  pl: 'PL',
  tr: 'TR',
  it: 'IT',
  nl: 'NL',
  pt: 'BR',
  fr: 'FR',
  es: 'ES',
}

const REGION_IN_CODE = /-([A-Z]{2})$/
const REGION_SUBTAG = /-(?:[A-Za-z]{2}|\d{3})$/

function regionOf(locale: ProjectLocale): string | null {
  const store = locale.store ?? {}
  const codes = [store.appstore, ...Object.values(store), locale.id].filter(Boolean)
  for (const code of codes) {
    const match = REGION_IN_CODE.exec(code)
    if (match) return match[1]
  }
  return FALLBACK_REGION[locale.id] ?? FALLBACK_REGION[locale.id.split('-')[0]] ?? null
}

const flagOf = (region: string) =>
  String.fromCodePoint(...Array.from(region, (c) => 0x1f1e6 + c.charCodeAt(0) - 65))

let names: Intl.DisplayNames | null = null

/** The region rides in the flag, so it is dropped from the name: `de-DE` reads "Deutsch". */
function nameOf(id: string): string {
  names ??= new Intl.DisplayNames(['de'], { type: 'language' })
  try {
    return names.of(id.replace(REGION_SUBTAG, '')) ?? id
  } catch {
    return id
  }
}

/** "🇩🇪 Deutsch" — German language names, as the owner reads them. */
export function localeLabel(locale: ProjectLocale): string {
  const region = regionOf(locale)
  const name = nameOf(locale.id)
  return region ? `${flagOf(region)} ${name}` : name
}
