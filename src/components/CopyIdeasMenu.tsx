import { useEffect, useRef, useState } from 'react'
import { COPY_IDEAS, COPY_IDEA_RULES, suggestedTileRole } from '../presets/copyIdeas'
import { TILE_ROLES } from '../project/types'
import type { TileRole } from '../project/types'
import { useStore } from '../store'

const ROLE_LABEL: Record<TileRole, string> = {
  hero: 'Hero',
  difference: 'Differentiator',
  feature: 'Feature',
  proof: 'Proof',
  closer: 'Closer',
}

/**
 * The headline field's "Ideas" popover: pick this slot's role (or take the suggestion for the
 * first/last tile), then drop one of that role's formulas into the headline of the copy being
 * edited right now. Closes on Escape and on a click outside — `ref` covers the trigger and the
 * panel together so a click on the button itself does not immediately reopen it.
 */
export function CopyIdeasMenu({
  slotId,
  role,
  index,
  total,
  lang,
  onPick,
}: {
  slotId: string
  role: TileRole | undefined
  index: number
  total: number
  /** the copy currently being edited: German formulas for 'de', English for everything else */
  lang: string
  onPick: (headline: string) => void
}) {
  const [open, setOpen] = useState(false)
  const setSlotRole = useStore((s) => s.setSlotRole)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const suggestion = suggestedTileRole(index, total)
  const active = role ?? suggestion
  const ideaLang = lang === 'de' ? 'de' : 'en'
  const ideas = active ? COPY_IDEAS[active] : []

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="linkish" onClick={() => setOpen((v) => !v)}>
        Ideas
      </button>
      {open && (
        <div className="ideas-popover flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {TILE_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                className="role-btn"
                data-active={r === active}
                title={!role && r === suggestion ? 'Suggested for this tile' : undefined}
                onClick={() => setSlotRole(slotId, r === role ? undefined : r)}
              >
                {ROLE_LABEL[r]}
                {!role && r === suggestion ? ' ?' : ''}
              </button>
            ))}
          </div>
          {active ? (
            <div className="flex flex-col gap-1">
              {ideas.map((idea) => (
                <button
                  key={idea[ideaLang]}
                  type="button"
                  className="idea-item"
                  onClick={() => {
                    onPick(idea[ideaLang])
                    setOpen(false)
                  }}
                >
                  <span className="idea-formula">{idea[ideaLang]}</span>
                  <span className="idea-example">{idea.example[ideaLang]}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
              Pick a role above to see its formulas.
            </p>
          )}
          <ul className="flex flex-col gap-1 text-[10px]" style={{ color: 'var(--muted)' }}>
            {COPY_IDEA_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
