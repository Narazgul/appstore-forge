import { useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { effectiveSettings } from '../lib/settings'
import { getLayout } from '../presets/layouts'
import { isSlotChip } from '../project/types'
import { sceneSpan } from '../render/scene'
import { useStore } from '../store'
import type { Screen } from '../types'
import { CopyIdeasMenu } from './CopyIdeasMenu'
import { ScreenPreview } from './ScreenPreview'
import { SourcePicker } from './SourcePicker'

/** Above these the renderer starts shrinking the text to keep it off the device. */
const HEADLINE_SOFT = 38
const SUBHEAD_SOFT = 90

/** Windows clipboard content carries \r\n; the renderer only ever looks for \n. */
const normalizeNewlines = (value: string) => value.replace(/\r\n?/g, '\n')
/** Only an explicit line break adds a row; soft wrapping would hide the rest of a one-line headline. */
const rowsFor = (value: string) => Math.min(4, (value.match(/\n/g)?.length ?? 0) + 1)
/** One list entry per line; blank lines are never entries. */
const linesToList = (value: string) =>
  normalizeNewlines(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/**
 * The store only ever holds the *cleaned* list (trimmed, blank lines dropped) — a textarea bound
 * straight to it would eat a trailing space or a blank line the user is mid-typing, since every
 * keystroke round-trips through `linesToList`. This keeps the raw text locally instead, and only
 * resyncs it from the stored list when the two have actually diverged — an outside change (undo,
 * switching locale, a reload), never the user's own edit landing back through the store, since
 * `linesToList(draft)` already equals the freshly stored list by the time that write completes.
 */
function ListTextarea({
  list,
  placeholder,
  onChange,
}: {
  list: string[] | undefined
  placeholder: string
  onChange: (list: string[]) => void
}) {
  const stored = list ?? []
  const [draft, setDraft] = useState(() => stored.join('\n'))
  if (linesToList(draft).join('\n') !== stored.join('\n')) setDraft(stored.join('\n'))

  return (
    <textarea
      className="field"
      rows={Math.min(8, Math.max(4, draft.split('\n').length))}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        const next = normalizeNewlines(e.target.value)
        setDraft(next)
        onChange(linesToList(next))
      }}
    />
  )
}

type Props = {
  screen: Screen
  index: number
  total: number
  width: number
  height: number
  /** true when this card is one of a set template's fixed slots */
  isSlot: boolean
}

export function ScreenCard({ screen, index, total, width, height, isSlot }: Props) {
  const updateScreen = useStore((s) => s.updateScreen)
  const removeScreen = useStore((s) => s.removeScreen)
  const clearImage = useStore((s) => s.clearImage)
  const setImage = useStore((s) => s.setImage)
  const moveScreen = useStore((s) => s.moveScreen)
  const selectedId = useStore((s) => s.selectedId)
  const selectScreen = useStore((s) => s.selectScreen)
  // A project takes its screenshots from the repo; replacing or clearing one here does nothing.
  const project = useStore((s) => s.project)
  const localeId = useStore((s) => s.localeId)
  const setCopy = useStore((s) => s.setCopy)
  const setChipText = useStore((s) => s.setChipText)
  const chips = useStore(
    useShallow(
      (s) => s.project?.set.slots.find((slot) => slot.id === screen.id)?.elements?.filter(isSlotChip) ?? [],
    ),
  )
  const note = useStore((s) => s.project?.set.slots.find((slot) => slot.id === screen.id)?.note ?? '')
  const setSlotNote = useStore((s) => s.setSlotNote)
  const role = useStore((s) => s.project?.set.slots.find((slot) => slot.id === screen.id)?.role)
  const layout = useStore((s) => getLayout(effectiveSettings(screen, s.settings).layout))
  const fileRef = useRef<HTMLInputElement>(null)
  // A tile takes the copy of every language with it, so the click asks once.
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [allLocales, setAllLocales] = useState(false)
  const span = useStore((s) => sceneSpan(screen, s.settings))

  const selected = selectedId === screen.id
  const overrides = Object.keys(screen.overrides).length
  const empty = screen.imageId === null
  const headLen = screen.headline.replace(/\*/g, '').length
  const otherLocales = project?.set.locales.filter((l) => l.id !== localeId) ?? []

  return (
    <div
      className="flex shrink-0 flex-col gap-3 rounded-2xl border p-3"
      style={{
        borderColor: selected ? 'var(--accent)' : 'var(--line)',
        boxShadow: selected ? '0 0 0 3px rgba(30,111,245,0.15)' : 'none',
        background: 'var(--panel)',
        width: width * span + 24,
      }}
      onClick={(e) => {
        e.stopPropagation()
        selectScreen(screen.id)
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void setImage(screen.id, file)
          e.target.value = ''
        }}
      />

      <div className="relative">
        <ScreenPreview screen={screen} width={width} height={height} editable />
        {empty && screen.kind !== 'artwork' && (
          <button
            className="slot-cta"
            onClick={(e) => {
              e.stopPropagation()
              fileRef.current?.click()
            }}
          >
            <span className="font-semibold">Add screenshot</span>
            <span style={{ opacity: 0.75 }}>Sample shown until you do</span>
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {layout.text === null ? (
          <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
            {layout.label} is a breather: the device speaks for itself. Give it a layout with text in the
            panel if you want copy here.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <input
                className="field"
                value={screen.eyebrow ?? ''}
                placeholder="Eyebrow (optional, one line)"
                onChange={(e) =>
                  updateScreen(screen.id, { eyebrow: e.target.value.replace(/[\r\n]+/g, ' ') })
                }
              />
            </div>
            <div className="flex items-center gap-1.5">
              <textarea
                className="field"
                wrap="off"
                style={{ resize: 'none', overflow: 'hidden' }}
                rows={rowsFor(screen.headline)}
                value={screen.headline}
                placeholder="Headline — *stars* highlight a word, Enter for a line break"
                onChange={(e) => updateScreen(screen.id, { headline: normalizeNewlines(e.target.value) })}
              />
              <span className="count" data-over={headLen > HEADLINE_SOFT}>
                {headLen}
              </span>
              {project && (
                <CopyIdeasMenu
                  slotId={screen.id}
                  role={role}
                  index={index}
                  total={total}
                  lang={localeId}
                  onPick={(headline) => updateScreen(screen.id, { headline })}
                />
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <textarea
                className="field"
                wrap="off"
                style={{ resize: 'none', overflow: 'hidden' }}
                rows={rowsFor(screen.subhead)}
                value={screen.subhead}
                placeholder="Subtitle (optional)"
                onChange={(e) => updateScreen(screen.id, { subhead: normalizeNewlines(e.target.value) })}
              />
              <span className="count" data-over={screen.subhead.length > SUBHEAD_SOFT}>
                {screen.subhead.length}
              </span>
            </div>
            {(layout.id === 'feature-wall' || (screen.list?.length ?? 0) > 0) && (
              <div className="flex flex-col gap-1">
                {layout.id !== 'feature-wall' && (
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                      List set but this layout is not feature-wall — unused
                    </span>
                    <button className="linkish" onClick={() => updateScreen(screen.id, { list: [] })}>
                      Remove
                    </button>
                  </div>
                )}
                <ListTextarea
                  list={screen.list}
                  placeholder="List, one entry per line (2–8) — *stars* highlight a word"
                  onChange={(list) => updateScreen(screen.id, { list })}
                />
              </div>
            )}
            {chips.map((chip) => (
              <div key={chip.id} className="flex items-center gap-1.5">
                <input
                  className="field"
                  value={project?.copies[localeId]?.[screen.id]?.chips?.[chip.id] ?? ''}
                  placeholder={`Chip "${chip.id}" — one line, e.g. "+312 € saved"`}
                  onChange={(e) =>
                    setChipText(localeId, screen.id, chip.id, e.target.value.replace(/[\r\n]+/g, ' '))
                  }
                />
              </div>
            ))}
            {otherLocales.length > 0 && (
              <>
                <button className="linkish self-start" onClick={() => setAllLocales(!allLocales)}>
                  {allLocales
                    ? 'Hide the other languages'
                    : otherLocales.length === 1
                      ? 'Write the other language'
                      : `Write the other ${otherLocales.length} languages`}
                </button>
                {allLocales &&
                  otherLocales.map((l) => {
                    // A hand-edited copy file may carry only one of the two fields.
                    const copy = project?.copies[l.id]?.[screen.id]
                    const headline = copy?.headline ?? ''
                    const len = headline.replace(/\*/g, '').length
                    return (
                      <div key={l.id} className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-9 shrink-0 text-[11px] font-semibold"
                            data-required={l.id === 'en' || l.id === 'de'}
                          >
                            {l.id}
                          </span>
                          <input
                            className="field"
                            value={copy?.eyebrow ?? ''}
                            placeholder="Eyebrow"
                            onChange={(e) =>
                              setCopy(l.id, screen.id, { eyebrow: e.target.value.replace(/[\r\n]+/g, ' ') })
                            }
                          />
                          <span className="count" aria-hidden />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-9 shrink-0" aria-hidden />
                          <textarea
                            className="field"
                            wrap="off"
                            style={{ resize: 'none', overflow: 'hidden' }}
                            rows={rowsFor(headline)}
                            value={headline}
                            placeholder="Headline"
                            onChange={(e) =>
                              setCopy(l.id, screen.id, { headline: normalizeNewlines(e.target.value) })
                            }
                          />
                          <span className="count" data-over={len > HEADLINE_SOFT}>
                            {len}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-9 shrink-0" aria-hidden />
                          <textarea
                            className="field"
                            wrap="off"
                            style={{ resize: 'none', overflow: 'hidden' }}
                            rows={rowsFor(copy?.subhead ?? '')}
                            value={copy?.subhead ?? ''}
                            placeholder="Subtitle (optional)"
                            onChange={(e) =>
                              setCopy(l.id, screen.id, { subhead: normalizeNewlines(e.target.value) })
                            }
                          />
                          <span className="count" aria-hidden />
                        </div>
                        {(layout.id === 'feature-wall' || (copy?.list?.length ?? 0) > 0) && (
                          <div className="flex items-center gap-1.5">
                            <span className="w-9 shrink-0" aria-hidden />
                            <ListTextarea
                              list={copy?.list}
                              placeholder="List, one entry per line"
                              onChange={(list) => setCopy(l.id, screen.id, { list })}
                            />
                            {layout.id !== 'feature-wall' && (
                              <button
                                className="seg"
                                title="List set but this layout is not feature-wall — unused"
                                onClick={() => setCopy(l.id, screen.id, { list: [] })}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        )}
                        {chips.map((chip) => (
                          <div key={chip.id} className="flex items-center gap-1.5">
                            <span className="w-9 shrink-0" aria-hidden />
                            <input
                              className="field"
                              value={copy?.chips?.[chip.id] ?? ''}
                              placeholder={`Chip "${chip.id}"`}
                              onChange={(e) =>
                                setChipText(l.id, screen.id, chip.id, e.target.value.replace(/[\r\n]+/g, ' '))
                              }
                            />
                            <span className="count" aria-hidden />
                          </div>
                        ))}
                      </div>
                    )
                  })}
              </>
            )}
          </>
        )}
        {project && screen.kind !== 'artwork' && <SourcePicker screen={screen} />}
        {project && (
          <textarea
            className="field note"
            rows={2}
            value={note}
            placeholder="Feedback for the agent (what should change on this screen?)"
            onChange={(e) => setSlotNote(screen.id, e.target.value)}
          />
        )}
      </div>

      <div className="flex items-center justify-between" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1.5 text-[11px] tabular-nums">
          {index + 1} / {total}
          {span > 1 && <span title="Exports as two store tiles">· 2 tiles</span>}
          {overrides > 0 && (
            <span
              className="dot"
              title={`${overrides} setting${overrides === 1 ? '' : 's'} set for this screen`}
            />
          )}
        </span>
        <div className="flex gap-1">
          <button className="seg" disabled={index === 0} onClick={() => moveScreen(screen.id, -1)}>
            ←
          </button>
          <button className="seg" disabled={index === total - 1} onClick={() => moveScreen(screen.id, 1)}>
            →
          </button>
          {!project && !empty && (
            <button className="seg" onClick={() => fileRef.current?.click()}>
              Replace
            </button>
          )}
          {project ? (
            confirmRemove ? (
              <>
                <button
                  className="seg"
                  title="Removes the tile and its headline in every language"
                  onClick={() => removeScreen(screen.id)}
                >
                  Remove?
                </button>
                <button className="seg" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button className="seg" onClick={() => setConfirmRemove(true)}>
                Remove
              </button>
            )
          ) : isSlot ? (
            !empty && (
              <button className="seg" onClick={() => clearImage(screen.id)}>
                Clear
              </button>
            )
          ) : (
            <button className="seg" onClick={() => removeScreen(screen.id)}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
