import { useState } from 'react'
import { formatOffset } from '../../lib/canvasEdit'
import type { Offset } from '../../types'

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * The move the canvas editor wrote for the device arrangement or the copy, read-only — dragging on
 * the tile is how it is set — with a Reset that drops it from the active scope.
 */
export function OffsetRow({
  offset,
  owned,
  onReset,
}: {
  offset: Offset | undefined
  owned: boolean
  onReset: () => void
}) {
  return (
    <Row label="Offset">
      <span className="flex-1 text-[12px] tabular-nums" data-offset={offset ? 'set' : 'none'}>
        {offset ? formatOffset(offset) : 'none, drag on the tile'}
      </span>
      <button className="seg" style={{ flex: 'none' }} disabled={!owned} onClick={onReset}>
        Reset
      </button>
    </Row>
  )
}

/** A collapsible panel section. Open/closed is remembered per section id across launches. */
export function Section({
  id,
  title,
  defaultOpen = true,
  overridden = false,
  onReset,
  children,
}: {
  id: string
  title: string
  defaultOpen?: boolean
  overridden?: boolean
  onReset?: () => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(`section:${id}`)
      return saved === null ? defaultOpen : saved === '1'
    } catch {
      return defaultOpen
    }
  })

  // The write stays OUT of the state updater: React may invoke an updater more than once,
  // and a second invocation would see the already-flipped value and persist the opposite.
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(`section:${id}`, next ? '1' : '0')
    } catch {
      /* private mode — the section still toggles, it just won't be remembered */
    }
  }

  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <button className="section-head" onClick={toggle} aria-expanded={open}>
        <span className="flex items-center gap-1.5">
          <span className="label">{title}</span>
          {overridden && <span className="dot" title="Set for this screen only" />}
        </span>
        <svg className="chev" data-open={open} width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 4l3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 px-4 pb-4">
          {children}
          {overridden && onReset && (
            <button className="linkish" onClick={onReset}>
              Reset to all screens
            </button>
          )}
        </div>
      )}
    </div>
  )
}
