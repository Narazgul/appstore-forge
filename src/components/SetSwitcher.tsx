import { useEffect, useState } from 'react'
import { duplicateProject, SET_ID_RE } from '../project/duplicate'
import { hasUnsavedWork, useStore } from '../store'

/**
 * The set switcher in the Rail header: which set is open, every other set the backend holds,
 * and "Duplicate set…" to branch a custom product page off the current one. Renders nothing when
 * the backend has no `listSets` — file mode without `--set` support, or an old backoffice build.
 */
export function SetSwitcher() {
  const project = useStore((s) => s.project)
  const projectStore = useStore((s) => s.projectStore)
  const [open, setOpen] = useState(false)
  const [sets, setSets] = useState<string[] | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  const [newId, setNewId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listSets = projectStore?.listSets

  useEffect(() => {
    if (!open || !listSets) return
    let cancelled = false
    listSets().then(
      (ids) => !cancelled && setSets(ids),
      () => !cancelled && setSets([]),
    )
    return () => {
      cancelled = true
    }
  }, [open, listSets])

  if (!project || !projectStore?.listSets) return null
  const currentId = projectStore.currentSetId ?? project.set.id

  const close = () => {
    setOpen(false)
    setDuplicating(false)
    setNewId('')
    setError(null)
  }

  const switchTo = (id: string) => {
    if (id === currentId) return close()
    // A native confirm is the simplest guard against losing a pending save; this tool has no
    // other modal primitive.
    if (hasUnsavedWork() && !window.confirm('This tab has unsaved changes. Switch sets and lose them?'))
      return
    projectStore.openSet?.(id)
  }

  const idTaken = !!newId && (sets ?? []).includes(newId)
  const idValid = SET_ID_RE.test(newId)

  const createDuplicate = async () => {
    if (!projectStore.createSet || !idValid || idTaken) return
    setBusy(true)
    setError(null)
    try {
      await projectStore.createSet(duplicateProject(project, newId))
      projectStore.openSet?.(newId)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mt-3">
      <button className="linkish" onClick={() => (open ? close() : setOpen(true))}>
        Set: {currentId} {open ? '▲' : '▾'}
      </button>
      {open ? (
        <div
          className="mt-2 flex flex-col gap-1 rounded-lg p-2"
          style={{ border: '1px solid var(--line)', background: '#fff' }}
        >
          {duplicating ? (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
                Renders to outputs/cpp/{newId || '<id>'}/ — the store upload folders stay untouched.
              </p>
              <input
                className="field"
                placeholder="new-set-id"
                value={newId}
                autoFocus
                onChange={(e) => setNewId(e.target.value)}
              />
              {newId && !idValid ? (
                <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                  Lowercase letters, digits and hyphens; must start with a letter or digit.
                </p>
              ) : null}
              {idTaken ? (
                <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                  A set with this id already exists.
                </p>
              ) : null}
              {error ? (
                <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button className="seg" disabled={busy} onClick={() => setDuplicating(false)}>
                  Cancel
                </button>
                <button
                  className="seg"
                  data-active="true"
                  disabled={busy || !idValid || idTaken}
                  onClick={() => void createDuplicate()}
                >
                  {busy ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {(sets ?? [currentId]).map((id) => (
                <button key={id} className="seg" data-active={id === currentId} onClick={() => switchTo(id)}>
                  {id}
                </button>
              ))}
              {projectStore.createSet ? (
                <button className="linkish mt-1" onClick={() => setDuplicating(true)}>
                  Duplicate set…
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
