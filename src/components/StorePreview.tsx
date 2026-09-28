import { useMemo, useState } from 'react'
import { sceneSpan } from '../render/scene'
import { getSize } from '../presets/sizes'
import { groupLeadingTiles, searchResultLabel } from '../lib/thumbnailGroup'
import { localeLabel } from '../project/localeLabel'
import { screensFor } from '../project/bridge'
import { useStore } from '../store'
import type { Screen } from '../types'
import { ScreenPreview } from './ScreenPreview'

/** Store tile width on the mock product page — roughly what the store's web page shows. */
const TILE = 196
/** App Store / Play search result tile width — the thumbnail test's whole point is that this is
 *  much smaller than the product page, so a headline that reads fine at `TILE` may not here. */
const THUMB_TILE = 160
const GAP = 10
/** How many leading store *tiles* (not screens — a span-2 screen counts as two) the search result
 *  actually shows. */
const THUMB_GROUP_SIZE = 3

/** One language's strip, rendered for the active target with the notes under their tiles.
 *  `groupFirstTiles` (thumbnail test only) visually fences off the leading tiles the search result
 *  shows — a screen counts as "in" the group the moment any of its tiles falls inside it, so a
 *  span-2 hero straddling the boundary is still fenced whole, but its tile past the boundary is
 *  dimmed and labelled: the search result shows only the first. */
function Strip({
  screens,
  notes,
  tile = TILE,
  groupFirstTiles,
}: {
  screens: Screen[]
  notes: Record<string, string>
  tile?: number
  groupFirstTiles?: number
}) {
  const settings = useStore((s) => s.settings)
  const size = getSize(settings.sizeId)
  const tileH = Math.round((tile * size.h) / size.w)

  const groupRows = groupLeadingTiles(screens, (screen) => sceneSpan(screen, settings), groupFirstTiles)
  const rows = groupRows.map((r) => ({
    screen: r.item,
    span: r.span,
    inGroup: r.inGroup,
    cutAt: r.inGroup && r.shown < r.span ? r.shown : null,
  }))

  const renderTile = ({ screen, span, cutAt }: { screen: Screen; span: number; cutAt: number | null }) => (
    <div key={screen.id} className="flex shrink-0 flex-col gap-1.5">
      <div className="flex" style={{ gap: GAP }}>
        {Array.from({ length: span }, (_, part) => (
          <div
            key={part}
            className="overflow-hidden rounded-xl"
            data-cut={(cutAt !== null && part >= cutAt) || undefined}
            style={{ width: tile, height: tileH }}
          >
            <div style={{ marginLeft: -part * tile }}>
              <ScreenPreview screen={screen} screens={screens} width={tile} height={tileH} />
            </div>
          </div>
        ))}
      </div>
      {cutAt !== null && (
        <span className="thumb-group-label" style={{ width: tile * span }}>
          Only the left half shows in the search result
        </span>
      )}
      {notes[screen.id] && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)', width: tile * span }}>
          {notes[screen.id]}
        </p>
      )}
    </div>
  )

  const grouped = rows.filter((r) => r.inGroup)
  const rest = rows.filter((r) => !r.inGroup)

  return (
    <div className="flex items-start overflow-x-auto pb-3" style={{ gap: GAP }}>
      {grouped.length > 0 && (
        <div className="thumb-group shrink-0">
          <div className="flex" style={{ gap: GAP }}>
            {grouped.map(renderTile)}
          </div>
          <span className="thumb-group-label">{searchResultLabel(groupRows)}</span>
        </div>
      )}
      {rest.map(renderTile)}
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
  // Pure view state: never written to the project, never saved, never undoable — switching it
  // back and forth changes nothing a reload or an approval would see.
  const [thumbnailTest, setThumbnailTest] = useState(false)

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

      <div className="flex items-center justify-between">
        <div className="store-section" style={{ margin: 0 }}>
          Preview
        </div>
        <button
          type="button"
          className="seg"
          style={{ flex: 'none' }}
          data-active={thumbnailTest}
          title="Show the tiles at App Store / Play search result size instead of the product page size"
          onClick={() => setThumbnailTest((v) => !v)}
        >
          Thumbnail test
        </button>
      </div>

      {project ? (
        strips.map(({ locale, screens: localeScreens }) => (
          <div key={locale.id}>
            <div className="store-section">{localeLabel(locale)}</div>
            <Strip
              screens={localeScreens}
              notes={notes}
              tile={thumbnailTest ? THUMB_TILE : TILE}
              groupFirstTiles={thumbnailTest ? THUMB_GROUP_SIZE : undefined}
            />
          </div>
        ))
      ) : (
        <Strip
          screens={screens}
          notes={notes}
          tile={thumbnailTest ? THUMB_TILE : TILE}
          groupFirstTiles={thumbnailTest ? THUMB_GROUP_SIZE : undefined}
        />
      )}

      <div className="store-section">Description</div>
      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)', maxWidth: 560 }}>
        Two or three short paragraphs in the store's voice go here. This page is a stand-in for the store
        product page so you can judge the strip at the size shoppers actually see it.
      </p>
    </div>
  )
}
