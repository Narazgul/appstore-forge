import { readiness } from '../lib/progress'
import { getSize } from '../presets/sizes'
import { getTemplateSpec } from '../presets/templates'
import { STEPS, useStore } from '../store'

const NEXT_LABEL: Record<string, string> = {
  target: 'Look',
  look: 'Screenshots',
  shots: 'Review',
}

/** Persistent status line plus the one primary action for the current step. */
export function Footer({ onExport, exporting }: { onExport: () => void; exporting: boolean }) {
  const step = useStore((s) => s.step)
  const setStep = useStore((s) => s.setStep)
  const project = useStore((s) => s.project)
  const screens = useStore((s) => s.screens)
  const settings = useStore((s) => s.settings)
  const template = useStore((s) => getTemplateSpec(s.templateId))
  const r = readiness(screens, settings)
  const size = getSize(settings.sizeId)
  const index = STEPS.indexOf(step)
  // Belongs in the footer and not in one step: a save can fail wherever the user is editing.
  const lastError = useStore((s) => s.lastError)

  const summary =
    r.total === 0
      ? `${template.label} · no screenshots yet · ${size.w}×${size.h} ${size.store}`
      : `${template.label} · ${r.filled} of ${r.total} screenshot${r.total === 1 ? '' : 's'}${r.tiles !== r.total ? ` · ${r.tiles} tiles` : ''} · ${size.w}×${size.h} ${size.store}`

  const exportLabel = exporting
    ? 'Exporting…'
    : r.total === 0
      ? 'Nothing to export yet'
      : r.missingShots > 0
        ? `Add ${r.missingShots} more screenshot${r.missingShots === 1 ? '' : 's'} to export`
        : `Export ${r.tiles} tile${r.tiles === 1 ? '' : 's'}`

  return (
    <footer className="footer">
      <span className="text-[12px]" style={{ color: lastError ? 'var(--warn)' : 'var(--muted)' }}>
        {lastError ?? summary}
      </span>
      <span className="flex items-center gap-2">
        {index > 0 && (
          <button className="btn" onClick={() => setStep(STEPS[index - 1])}>
            ← Back
          </button>
        )}
        {step === 'review' && project ? (
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Render with: forge render --project &lt;dir&gt; --require-approval
          </span>
        ) : step === 'review' ? (
          <button className="btn-primary" disabled={!r.canExport || exporting} onClick={onExport}>
            {exportLabel}
          </button>
        ) : (
          <button className="btn-primary" onClick={() => setStep(STEPS[index + 1])}>
            Next: {NEXT_LABEL[step]} →
          </button>
        )}
      </span>
    </footer>
  )
}
