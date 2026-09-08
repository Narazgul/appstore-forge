/** Shared header for a step: what to do here, and why it matters for the store. */
export function StepFrame({
  title,
  lead,
  aside,
  wide = false,
  children,
}: {
  title: string
  lead: string
  aside?: React.ReactNode
  /** the workbench needs the room the control panel takes away */
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex w-full flex-col gap-6" style={{ maxWidth: wide ? '1600px' : '72rem' }}>
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {lead}
          </p>
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="tip">
      <span className="tip-mark" aria-hidden>
        i
      </span>
      <span>{children}</span>
    </div>
  )
}
