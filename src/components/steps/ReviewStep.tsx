import { useState } from 'react'
import { readiness } from '../../lib/progress'
import { useStore } from '../../store'
import { LocaleGrid } from '../LocaleGrid'
import { StorePreview } from '../StorePreview'
import { StepFrame } from './StepFrame'

type Check = { ok: boolean; text: string; fix?: { label: string; step: 'shots' | 'copy' | 'target' } }

/** In project mode the whole locale grid with its approval stamp, otherwise the readiness
 *  checklist against the store's rules; both end on the set as a mock product page. */
export function ReviewStep() {
  const screens = useStore((s) => s.screens)
  const settings = useStore((s) => s.settings)
  const format = useStore((s) => s.format)
  const setFormat = useStore((s) => s.setFormat)
  const setStep = useStore((s) => s.setStep)
  const project = useStore((s) => s.project)
  const approvalOk = useStore((s) => s.approvalOk)
  const staleApproval = useStore((s) => s.staleApproval)
  const lastError = useStore((s) => s.lastError)
  const setLastError = useStore((s) => s.setLastError)
  const approve = useStore((s) => s.approve)
  const targetId = useStore((s) => s.targetId)
  const setTarget = useStore((s) => s.setTarget)
  const [by, setBy] = useState(() => localStorage.getItem('forge-approver') ?? '')

  if (project) {
    const stamp = project.set.approval
    return (
      <StepFrame
        title="Review all languages"
        lead="Every language for the selected target. Approve when the whole grid is right; the CLI refuses to render for upload without a matching stamp."
        aside={
          <div
            className="flex gap-1 rounded-lg p-1"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
          >
            {project.set.targets.map((t) => (
              <button
                key={t.id}
                className="seg"
                data-active={targetId === t.id}
                onClick={() => setTarget(t.id)}
              >
                {t.id}
              </button>
            ))}
          </div>
        }
      >
        <div
          className="flex flex-col gap-2 rounded-xl border p-3"
          style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
        >
          <div className="flex items-center gap-3">
            <span
              className="check-mark"
              data-ok={approvalOk === true}
              style={{
                background: approvalOk ? 'var(--ok-bg)' : 'var(--warn-bg)',
                color: approvalOk ? 'var(--ok)' : 'var(--warn)',
              }}
              aria-hidden
            >
              {approvalOk ? '✓' : '!'}
            </span>
            <span className="flex-1 text-[13px]">
              {approvalOk
                ? `Approved by ${stamp?.by} on ${stamp?.at}`
                : staleApproval
                  ? `Changed since the approval by ${staleApproval.by} on ${staleApproval.at}`
                  : 'Not approved yet'}
            </span>
            <input
              className="field"
              // `.field` sets width:100% after Tailwind's layer, so a `w-40` class would lose to it.
              style={{ width: '10rem', flex: 'none' }}
              value={by}
              placeholder="Your name"
              onChange={(e) => {
                setBy(e.target.value)
                localStorage.setItem('forge-approver', e.target.value)
              }}
            />
            <button
              className="btn-primary"
              disabled={!by.trim() || approvalOk === true}
              onClick={() => {
                approve(by.trim()).catch((err: unknown) =>
                  setLastError(err instanceof Error ? err.message : String(err)),
                )
              }}
            >
              Approve
            </button>
          </div>
          {lastError && (
            <p className="text-[12px]" style={{ color: '#dc2626' }}>
              {lastError}
            </p>
          )}
        </div>
        <LocaleGrid />
        <StorePreview />
      </StepFrame>
    )
  }

  const r = readiness(screens, settings)

  const checks: Check[] = [
    r.total === 0
      ? { ok: false, text: 'No screenshots yet', fix: { label: 'Add screenshots', step: 'shots' } }
      : r.missingShots > 0
        ? {
            ok: false,
            text: `${r.missingShots} slot${r.missingShots === 1 ? '' : 's'} still empty`,
            fix: { label: 'Fill them', step: 'shots' },
          }
        : { ok: true, text: `All ${r.total} screenshots in place` },
    r.missingCopy > 0
      ? {
          ok: false,
          text: `${r.missingCopy} screen${r.missingCopy === 1 ? '' : 's'} without a headline`,
          fix: { label: 'Write copy', step: 'copy' },
        }
      : { ok: true, text: 'Every screen that shows copy has a headline' },
    r.overLimit
      ? {
          ok: false,
          text: `${r.tiles} tiles — ${r.store} accepts at most ${r.limit.max}`,
          fix: { label: 'Remove some', step: 'shots' },
        }
      : r.underMin
        ? {
            ok: false,
            text: `${r.tiles} tile — ${r.store} wants at least ${r.limit.min}`,
            fix: { label: 'Add more', step: 'shots' },
          }
        : {
            ok: true,
            text: `${r.tiles} tile${r.tiles === 1 ? '' : 's'} — within ${r.store}'s ${r.limit.min}–${r.limit.max}`,
          },
    r.store === 'App Store' && format === 'png'
      ? {
          ok: false,
          text: 'PNG carries an alpha channel; App Store Connect can reject it',
          fix: { label: 'Use JPEG', step: 'target' },
        }
      : {
          ok: true,
          text:
            format === 'jpeg'
              ? 'JPEG — no alpha channel, accepted everywhere'
              : 'PNG is fine for Google Play',
        },
  ]

  return (
    <StepFrame
      title="Review & export"
      lead="A last look at the set the way shoppers will see it, and the store rules checked before you upload."
      aside={
        <div className="flex items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            Format
          </span>
          <div
            className="flex gap-1 rounded-lg p-1"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}
          >
            <button className="seg" data-active={format === 'png'} onClick={() => setFormat('png')}>
              PNG
            </button>
            <button className="seg" data-active={format === 'jpeg'} onClick={() => setFormat('jpeg')}>
              JPEG
            </button>
          </div>
        </div>
      }
    >
      <ul className="checklist">
        {checks.map((c) => (
          <li key={c.text} data-ok={c.ok}>
            <span className="check-mark" aria-hidden>
              {c.ok ? '✓' : '!'}
            </span>
            <span className="flex-1 text-[13px]">{c.text}</span>
            {!c.ok && c.fix && (
              <button
                className="linkish"
                onClick={() => (c.fix!.step === 'target' ? setFormat('jpeg') : setStep(c.fix!.step))}
              >
                {c.fix.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      <StorePreview />
    </StepFrame>
  )
}
