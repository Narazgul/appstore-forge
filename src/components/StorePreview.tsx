import { useMemo } from 'react'
import { sceneSpan } from '../render/scene'
import { getSize } from '../presets/sizes'
import { localeLabel } from '../project/localeLabel'
import { screensFor } from '../project/bridge'
import { useStore } from '../store'
import type { Screen } from '../types'
import { ScreenPreview } from './ScreenPreview'

/** Store tile width on the mock product page — roughly what the store's web page shows. */
const TILE = 196
const GAP = 10

/** One language's strip, rendered for the active target with the notes under their tiles. */
function Strip({ screens, notes }: { screens: Screen[]; notes: Record<string, string> }) {
  const settings = useStore((s) => s.settings)
  const size = getSize(settings.sizeId)
  const tileH = Math.round((TILE * size.h) / size.w)

  return (
    <div className="flex overflow-x-auto pb-3" style={{ gap: GAP }}>
      {screens.map((screen) => {
        const span = sceneSpan(screen, settings)
        return (
          <div key={screen.id} className="flex shrink-0 flex-col gap-1.5">
            <div className="flex" style={{ gap: GAP }}>
              {Array.from({ length: span }, (_, part) => (
                <div key={part} className="overflow-hidden rounded-xl" style={{ width: TILE, height: tileH }}>
                  <div style={{ marginLeft: -part * TILE }}>
                    <ScreenPreview screen={screen} screens={screens} width={TILE} height={tileH} />
                  </div>
                </div>
              ))}
            </div>
            {notes[screen.id] && (
              <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)', width: TILE * span }}>
                {notes[screen.id]}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The set inside a mock store product page. The chrome around the strip is what tells you
 * whether a headline still reads at gallery size; a panorama shows as the two separate tiles
 * with the store's gap between them, exactly as it will upload. A project shows one strip per
 * language, because a set is only finished when every language is.
 */
export function StorePreview() {
  const screens = useStore((s) => s.screens)
  const settings = useStore((s) => s.settings)
  const listing = useStore((s) => s.listing)
  const setListing = useStore((s) => s.setListing)
  const project = useStore((s) => s.project)
  const play = getSize(settings.sizeId).store === 'Google Play'

  const strips = useMemo(
    () =>
      project
        ? project.set.locales.map((locale) => ({ locale, screens: screensFor(project, locale.id) }))
        : [],
    [project],
  )
  const notes = useMemo(() => {
    const map: Record<string, string> = {}
    for (const slot of project?.set.slots ?? []) if (slot.note?.trim()) map[slot.id] = slot.note.trim()
    return map
  }, [project])

  return (
    <div className="store">
      <div className="store-head">
        <div className="store-icon" data-play={play || undefined} aria-hidden />
        <div className="min-w-0 flex-1">
          <input
            className="store-name"
            value={listing.name}
            placeholder="App name"
            onChange={(e) => setListing({ name: e.target.value })}
          />
          <input
            className="store-sub"
            value={listing.subtitle}
            placeholder="Subtitle — under 30 characters"
            onChange={(e) => setListing({ subtitle: e.target.value })}
          />
          <div className="mt-2 flex items-center gap-3">
            <span className={play ? 'store-install' : 'store-get'}>{play ? 'Install' : 'GET'}</span>
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {play ? 'Contains ads · In-app purchases' : 'In-App Purchases'}
            </span>
          </div>
        </div>
      </div>

      {play ? (
        <div className="store-playstats">4.8 ★ · 1.2K reviews · 10K+ Downloads · Rated for 3+</div>
      ) : (
        <div className="store-stats">
          {[
            ['4.8', '★★★★★', '1.2K Ratings'],
            ['#12', '', listing.category || 'Productivity'],
            ['4+', '', 'Age'],
            [listing.developer || 'Developer', '', 'Developer'],
          ].map(([big, mid, small]) => (
            <div key={small} className="store-stat">
              <div className="store-stat-big">{big}</div>
              {mid && <div className="store-stat-mid">{mid}</div>}
              <div className="store-stat-small">{small}</div>
            </div>
          ))}
        </div>
      )}

      {project ? (
        strips.map(({ locale, screens: localeScreens }) => (
          <div key={locale.id}>
            <div className="store-section">Preview {localeLabel(locale)}</div>
            <Strip screens={localeScreens} notes={notes} />
          </div>
        ))
      ) : (
        <>
          <div className="store-section">Preview</div>
          <Strip screens={screens} notes={notes} />
        </>
      )}

      <div className="store-section">Description</div>
      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)', maxWidth: 560 }}>
        Two or three short paragraphs in the store's voice go here. This page is a stand-in for the store
        product page so you can judge the strip at the size shoppers actually see it.
      </p>
    </div>
  )
}
