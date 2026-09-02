import { readiness } from '../lib/progress'
import { getRhythm } from '../presets/rhythms'
import { getSize } from '../presets/sizes'
import { getTemplateSpec } from '../presets/templates'
import { STEPS, useStore, type StepId } from '../store'
import { LocaleSwitch } from './LocaleSwitch'

type Status = 'done' | 'attention' | 'todo' | 'optional'

const TITLES: Record<StepId, string> = {
  target: 'Target',
  look: 'Look',
  shots: 'Screenshots',
  copy: 'Copy',
  tune: 'Fine-tune',
  review: 'Review & export',
}

/**
 * The guided flow as a left rail: every step, its current value or progress, and a status
 * colour. It is navigation and a checklist, not a gate — any step is one click away, in any order.
 */
export function Rail() {
  const step = useStore((s) => s.step)
  const setStep = useStore((s) => s.setStep)
  const screens = useStore((s) => s.screens)
  const settings = useStore((s) => s.settings)
  const template = useStore((s) => getTemplateSpec(s.templateId))
  const rhythmId = useStore((s) => s.rhythmId)
  const r = readiness(screens, settings)
  const size = getSize(settings.sizeId)
  const customised = screens.filter((s) =>
    Object.keys(s.overrides).some(
      (k) => !['layout', 'positionId', 'textAlign', 'background', 'backdropColor', 'highlights'].includes(k),
    ),
  ).length

  const rhythmLabel = rhythmId === 'template' ? `${template.label}'s own` : getRhythm(rhythmId).label
  const info: Record<StepId, { status: Status; detail: string }> = {
    target: { status: 'done', detail: `${size.store} · ${size.label}` },
    look: { status: 'done', detail: `${template.label} · ${rhythmLabel} rhythm` },
    shots:
      r.total === 0
        ? { status: 'todo', detail: 'None yet' }
        : r.missingShots > 0
          ? { status: 'attention', detail: `${r.filled} of ${r.total} added` }
          : { status: 'done', detail: `${r.total} added · ${r.tiles} tile${r.tiles === 1 ? '' : 's'}` },
    copy:
      r.total === 0
        ? { status: 'todo', detail: 'Headlines & subtitles' }
        : r.missingCopy > 0
          ? {
              status: 'attention',
              detail: `${r.missingCopy} headline${r.missingCopy === 1 ? '' : 's'} missing`,
            }
          : { status: 'done', detail: 'Every screen has a headline' },
    tune: {
      status: 'optional',
      detail: customised ? `${customised} screen${customised === 1 ? '' : 's'} customised` : 'Optional',
    },
    review:
      r.total === 0
        ? { status: 'todo', detail: 'Check & export' }
        : r.canExport && r.missingCopy === 0 && !r.overLimit
          ? { status: 'done', detail: 'Ready to export' }
          : {
              status: 'attention',
              detail: `${(r.missingShots ? 1 : 0) + (r.missingCopy ? 1 : 0) + (r.overLimit ? 1 : 0)} to fix`,
            },
  }

  return (
    <nav className="rail">
      <div className="rail-head">
        <div className="text-[14px] font-semibold tracking-tight">AppStore Forge</div>
        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
          v{__APP_VERSION__}
        </div>
        <LocaleSwitch />
      </div>
      <ol className="flex flex-col gap-0.5 px-2">
        {STEPS.map((id, i) => {
          const { status, detail } = info[id]
          return (
            <li key={id}>
              <button
                className="rail-step"
                data-active={step === id}
                data-status={status}
                onClick={() => setStep(id)}
              >
                <span className="rail-num">{status === 'done' ? '✓' : i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{TITLES[id]}</span>
                  <span className="block truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                    {detail}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-auto px-4 pb-4 text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
        Steps are a checklist, not a gate — jump anywhere. Drop screenshots on any step.
      </p>
    </nav>
  )
}
