import type { TileRole } from '../project/types'

/**
 * One headline pattern, in both languages the "Ideas" menu ever shows (`ScreenCard.tsx` picks
 * English or German by the copy currently being edited — `CopyIdeasMenu`'s `lang`). `\n` is an
 * intentional line break, the same convention a headline already uses; picking a formula drops it
 * into the headline as-is, brackets included — the user replaces them with the app's own words,
 * exactly like the source library this is ported from (see `NOTICE`).
 */
export type CopyFormula = {
  en: string
  de: string
  /** a concrete line for a GetALife-style budget app (the envelope method), one `*word*` marked
   *  like the app's own copy (`aso/copy/*.json`) — proof the formula reads naturally once filled in */
  example: { en: string; de: string }
}

/**
 * Formulas by deck slot, ported from `ParthJadhav/app-store-screenshots`'s `copy-ideas.md`
 * (`hero`/`differentiator`/`feature`/`proof`/`closer`, renamed `difference` here to match
 * `TileRole`) and its leaner `copy-ideas.ts`, then translated idiomatically — not word for word —
 * into the German the rest of `aso/copy/de.json` already uses (informal "du", short lines, no
 * dashes). See `NOTICE` for the license.
 */
export const COPY_IDEAS: Record<TileRole, CopyFormula[]> = {
  hero: [
    {
      en: '[Outcome], without [pain].',
      de: '[Ergebnis], ganz ohne [Problem].',
      example: {
        en: 'Full *overview*, without the spreadsheet.',
        de: 'Voller *Überblick*, ganz ohne Excel.',
      },
    },
    {
      en: 'Your [noun],\n[benefit].',
      de: 'Dein [Substantiv],\n[Nutzen].',
      example: { en: 'Your money,\n*finally in envelopes*.', de: 'Dein Geld,\n*endlich in Umschlägen*.' },
    },
    {
      en: '[Verb] [noun].\n[Verb] [noun].',
      de: '[Verb] [Substantiv].\n[Verb] [Substantiv].',
      example: { en: 'Fill envelopes.\n*Watch it add up*.', de: 'Umschläge füllen.\n*Geld wachsen sehen*.' },
    },
    {
      en: 'Every [noun],\n[outcome].',
      de: 'Jeder [Substantiv],\n[Ergebnis].',
      example: { en: '*Every euro*,\nin its envelope.', de: '*Jeder Euro*\nin seinem Umschlag.' },
    },
    {
      en: 'Meet your new [role].',
      de: 'Dein neuer [Rolle].',
      example: { en: 'Meet your new *budget coach*.', de: 'Dein neuer *Finanz-Coach*.' },
    },
    {
      en: 'The [adjective] way to [verb] [noun].',
      de: 'So [Adjektiv] geht [Substantiv].',
      example: { en: 'The calm way to run your budget.', de: 'So *entspannt* geht Budgetplanung.' },
    },
  ],
  difference: [
    {
      en: 'Only [app] [does the unique thing].',
      de: 'Nur [App] [macht das Besondere].',
      example: {
        en: 'Only GetALife *celebrates your streak*.',
        de: 'Nur *GetALife* feiert deine Sparserie.',
      },
    },
    {
      en: '[Old way] [does X].\n[App] [does Y].',
      de: '[Alter Weg] [macht X].\n[App] [macht Y].',
      example: { en: 'Spreadsheets count.\n*GetALife plans*.', de: 'Excel zählt.\n*GetALife denkt mit*.' },
    },
    {
      en: 'No [pain]. No [pain]. Just [outcome].',
      de: 'Kein [Problem]. Kein [Problem]. Nur [Ergebnis].',
      example: { en: 'No cash. No chaos. Just *clarity*.', de: 'Kein Bargeld. Kein Chaos. Nur *Klarheit*.' },
    },
    {
      en: 'Built for [specific person].',
      de: 'Gemacht für [bestimmte Person].',
      example: { en: 'Built for people who hate spreadsheets.', de: 'Gemacht für alle, die *Excel hassen*.' },
    },
    {
      en: '[Verb] it once.\n[Outcome] forever.',
      de: 'Einmal [Verb].\n[Ergebnis] für immer.',
      example: {
        en: 'Set it up once.\n*Stay on track* forever.',
        de: 'Einmal einrichten.\n*Für immer* den Überblick.',
      },
    },
  ],
  feature: [
    {
      en: '[Verb] [noun] in [time].',
      de: '[Substantiv] in [Zeit] [Verb].',
      example: { en: 'Log an expense in *3 seconds*.', de: 'Ausgabe *in 3 Sekunden* erfasst.' },
    },
    {
      en: 'See [thing] at a glance.',
      de: '[Sache] auf einen Blick.',
      example: { en: 'See every account at a glance.', de: '*Alle Konten* auf einen Blick.' },
    },
    {
      en: '[Noun], sorted.',
      de: '[Substantiv], sortiert.',
      example: { en: 'Your envelopes, *sorted* by month.', de: 'Deine Umschläge, *sortiert* nach Monat.' },
    },
    {
      en: 'Never [pain] again.',
      de: 'Nie wieder [Problem].',
      example: { en: 'Never lose track again.', de: '*Nie wieder* den Überblick verlieren.' },
    },
    {
      en: 'From [before] to [after].',
      de: 'Von [vorher] zu [nachher].',
      example: { en: 'From receipt to budget in *one tap*.', de: 'Vom Beleg zum Budget, *ein Fingertipp*.' },
    },
    {
      en: 'Right on your [surface].',
      de: 'Direkt auf deinem [Ort].',
      example: { en: 'Right on your *lock screen*.', de: 'Direkt auf deinem *Sperrbildschirm*.' },
    },
  ],
  proof: [
    {
      en: '[Number] [people] [verb] [app].',
      de: '[Zahl] [Personen] nutzen [App].',
      example: {
        en: '*40,000 people* budget with GetALife.',
        de: '*40.000 Menschen* budgetieren mit GetALife.',
      },
    },
    {
      en: 'Loved by [specific group].',
      de: 'Beliebt bei [Zielgruppe].',
      example: { en: 'Loved by *cash-stuffing* fans.', de: 'Beliebt bei *Cash-Stuffing*-Fans.' },
    },
    {
      en: '[Rating] from [number] reviews.',
      de: '[Bewertung] bei [Zahl] Bewertungen.',
      example: { en: '*4.8 stars* from 3,000 reviews.', de: '*4,8 Sterne* bei 3.000 Bewertungen.' },
    },
    {
      en: 'Private by design.',
      de: 'Privat von Anfang an.',
      example: {
        en: '*Private by design*, your data stays yours.',
        de: '*Verschlüsselt*, deine Daten bleiben deine.',
      },
    },
    {
      en: 'As seen in [publication].',
      de: 'Vorgestellt bei [Publikation].',
      example: { en: 'As seen in *Finance Weekly*.', de: 'Vorgestellt bei *Finanz-Podcast XY*.' },
    },
  ],
  closer: [
    {
      en: '[Feature] · [Feature] · [Feature] · [Feature].',
      de: '[Feature] · [Feature] · [Feature] · [Feature].',
      example: {
        en: '*Envelopes* · Streaks · Reports · Reminders.',
        de: '*Umschläge* · Serien · Berichte · Erinnerungen.',
      },
    },
    {
      en: 'And so much more.',
      de: 'Und noch viel mehr.',
      example: { en: 'And *so much more*.', de: 'Und *noch viel mehr*.' },
    },
    {
      en: 'Made for people who [care about X].',
      de: 'Für alle, denen [X] wichtig ist.',
      example: {
        en: 'Made for people who care about their money.',
        de: 'Für alle, denen *ihr Geld* wichtig ist.',
      },
    },
    {
      en: 'Your first [unit] starts today.',
      de: 'Dein erster [Zeitraum] beginnt heute.',
      example: {
        en: 'Your first *month with a plan* starts today.',
        de: 'Dein erster *Monat mit Plan* beginnt heute.',
      },
    },
    {
      en: 'Your [thing]. Your [rules].',
      de: 'Dein [Ding]. Deine [Regeln].',
      example: { en: 'Your money. *Your rules*.', de: 'Dein Geld. *Deine Regeln*.' },
    },
  ],
}

/** The role an unset slot is offered first in the "Ideas" menu — a suggestion only, nothing is
 *  written until the user actually picks one (`CopyIdeasMenu.tsx`). */
export function suggestedTileRole(index: number, total: number): TileRole | undefined {
  if (total <= 0) return undefined
  if (index === 0) return 'hero'
  if (index === total - 1) return 'closer'
  return undefined
}

/**
 * Editor guidance shown under the formulas, in English like the rest of the GUI's labels —
 * distilled from the same source's Iron Rules and its "weak vs. better" table.
 */
export const COPY_IDEA_RULES: string[] = [
  'One idea per headline, never two crammed together.',
  'Lead with the verb or the outcome, not the app name.',
  'Keep every line short enough to survive the thumbnail test.',
  'A line break is a beat: place it where you would pause speaking it.',
  'Cut "seamless", "powerful", "AI-powered" and anything a competitor could say too.',
  'Proof needs real numbers, ratings and mentions; the examples here are made up.',
]
