import { useRef } from 'react'
import { sceneSpan } from '../render/scene'
import { useStore } from '../store'
import type { Screen } from '../types'
import { ScreenPreview } from './ScreenPreview'
import { SourcePicker } from './SourcePicker'

type Props = {
  screen: Screen
  index: number
  total: number
  width: number
  height: number
  /** true when this card is one of a set template's fixed slots */
  isSlot: boolean
  /** preview + selection only — for the Fine-tune step, where the panel does the editing */
  compact?: boolean
}

export function ScreenCard({ screen, index, total, width, height, isSlot, compact = false }: Props) {
  const updateScreen = useStore((s) => s.updateScreen)
  const removeScreen = useStore((s) => s.removeScreen)
  const clearImage = useStore((s) => s.clearImage)
  const setImage = useStore((s) => s.setImage)
  const moveScreen = useStore((s) => s.moveScreen)
  const selectedId = useStore((s) => s.selectedId)
  const selectScreen = useStore((s) => s.selectScreen)
  // A project takes its screenshots from the repo; replacing or clearing one here does nothing.
  const project = useStore((s) => s.project)
  const note = useStore((s) => s.project?.set.slots.find((slot) => slot.id === screen.id)?.note ?? '')
  const setSlotNote = useStore((s) => s.setSlotNote)
  const fileRef = useRef<HTMLInputElement>(null)
  const span = useStore((s) => sceneSpan(screen, s.settings))

  const selected = selectedId === screen.id
  const overrides = Object.keys(screen.overrides).length
  const empty = screen.imageId === null

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
        <ScreenPreview screen={screen} width={width} height={height} />
        {empty && (
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

      {!compact && (
        <div className="flex flex-col gap-1.5">
          <input
            className="field"
            value={screen.headline}
            placeholder="Headline — *stars* highlight a word"
            onChange={(e) => updateScreen(screen.id, { headline: e.target.value })}
          />
          <input
            className="field"
            value={screen.subhead}
            placeholder="Subtitle (optional)"
            onChange={(e) => updateScreen(screen.id, { subhead: e.target.value })}
          />
          {project && <SourcePicker screen={screen} />}
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
      )}

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
        {compact ? (
          <span className="text-[11px]">
            {selected ? 'Editing this screen' : 'Click to edit only this one'}
          </span>
        ) : (
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
            {!project &&
              (isSlot ? (
                !empty && (
                  <button className="seg" onClick={() => clearImage(screen.id)}>
                    Clear
                  </button>
                )
              ) : (
                <button className="seg" onClick={() => removeScreen(screen.id)}>
                  Remove
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
