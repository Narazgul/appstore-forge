import { useState } from 'react'
import { useStore } from '../store'
import type { ToolStep } from './agent'
import { aiTransport } from './endpoint'
import { EMPTY, outcomeText, startJob, useAiStore } from './session'

const label = (step: ToolStep) => {
  const { slot, element, slots } = step.input as { slot?: string; element?: unknown; slots?: string[] }
  const where = slot ?? (Array.isArray(slots) ? slots.join(', ') : undefined)
  const el = typeof element === 'string' ? element : undefined
  return [step.name, where, el].filter(Boolean).join(' · ')
}

const STATUS: Record<ToolStep['status'], string> = { running: '…', ok: '✓', error: '✕', cancelled: '–' }

/**
 * "Describe a change": an instruction in plain words, carried out by Claude with the same tools an
 * agent uses on the command line, on the set that is open here. Shown only where the host offers
 * an AI endpoint; every change lands like a hand edit and one Undo takes a whole job back.
 */
export function AiPanel() {
  const project = useStore((s) => s.project)
  const log = useAiStore((s) => s.log)
  const running = useAiStore((s) => s.running)
  const tokens = useAiStore((s) => s.tokens)
  const hasConversation = useAiStore((s) => s.messages.length > 0)
  const [text, setText] = useState('')
  if (!aiTransport() || !project) return null

  const submit = () => {
    const instruction = text.trim()
    if (!instruction || running) return
    setText('')
    void startJob(instruction)
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border p-4" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">Describe a change</span>
        <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
          Claude changes the open set, looks at a preview and corrects itself. Undo takes a whole job back.
        </span>
      </div>
      {log.length > 0 && (
        <ol className="flex max-h-[360px] flex-col gap-1.5 overflow-auto text-[12px]">
          {log.map((entry, i) => (
            <li key={i}>
              {entry.kind === 'instruction' && <p className="font-semibold">{entry.text}</p>}
              {entry.kind === 'note' && <p style={{ color: 'var(--muted)' }}>{entry.text}</p>}
              {entry.kind === 'step' && (
                <div className="flex flex-col gap-1">
                  <span style={{ color: entry.step.status === 'error' ? 'var(--warn)' : 'var(--muted)' }}>
                    {STATUS[entry.step.status]} {label(entry.step)}
                    {entry.step.error ? ` — ${entry.step.error}` : ''}
                  </span>
                  {entry.step.images && (
                    <span className="flex flex-wrap gap-2">
                      {entry.step.images.map((src, n) => (
                        <img key={n} src={src} alt="" className="h-[120px] rounded border" />
                      ))}
                    </span>
                  )}
                </div>
              )}
              {entry.kind === 'outcome' && (
                <p
                  className="whitespace-pre-wrap"
                  style={{ color: entry.outcome.kind === 'done' ? 'var(--ink)' : 'var(--warn)' }}
                >
                  {outcomeText(entry.outcome)}
                </p>
              )}
              {entry.kind === 'saveFailed' && (
                <p style={{ color: 'var(--warn)' }}>Not saved: {entry.message}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="flex items-end gap-2">
        <textarea
          className="field min-h-[56px] flex-1"
          value={text}
          placeholder="e.g. make the card on the second tile bigger and move the headline up"
          disabled={!!running}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        {running ? (
          <button className="btn" onClick={() => running.abort()}>
            Cancel
          </button>
        ) : (
          <button className="btn btn-primary" disabled={!text.trim()} onClick={submit}>
            Send
          </button>
        )}
      </div>
      {(hasConversation || log.length > 0) && !running && (
        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--muted)' }}>
          <span>
            Tokens: {tokens.input + tokens.cacheRead} in ({tokens.cacheRead} from cache), {tokens.output} out
          </span>
          <button className="underline" onClick={() => useAiStore.setState({ ...EMPTY })}>
            New conversation
          </button>
        </div>
      )}
    </section>
  )
}
