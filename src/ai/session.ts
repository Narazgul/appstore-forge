import { create } from 'zustand'
import { flushSave, useStore } from '../store'
import { apiTools, runJob, type JobOutcome, type ToolStep } from './agent'
import { canRemember, editorHost } from './editorHost'
import { aiTransport } from './endpoint'
import type { AgentMessage, ApiTool } from './protocol'

export type LogEntry =
  | { kind: 'instruction'; text: string }
  | { kind: 'step'; step: ToolStep }
  | { kind: 'note'; text: string }
  | { kind: 'outcome'; outcome: JobOutcome }
  | { kind: 'saveFailed'; message: string }

type AiState = {
  messages: AgentMessage[]
  /** fixed for a conversation: a different tool list or system text would void the prompt cache
   *  and the model's own earlier reasoning */
  tools: ApiTool[] | null
  guidelines: string
  setId: string | null
  log: LogEntry[]
  running: AbortController | null
  tokens: { input: number; output: number; cacheRead: number }
}

export const EMPTY: Omit<AiState, 'running'> = {
  messages: [],
  tools: null,
  guidelines: '',
  setId: null,
  log: [],
  tokens: { input: 0, output: 0, cacheRead: 0 },
}

export const useAiStore = create<AiState>(() => ({ ...EMPTY, running: null }))

export function outcomeText(outcome: JobOutcome): string {
  switch (outcome.kind) {
    case 'done':
      return outcome.text || 'Done.'
    case 'cancelled':
      return 'Cancelled. What already ran stays in the set; Undo takes the whole job back.'
    case 'refused':
      return `Claude declined this request${outcome.category ? ` (${outcome.category})` : ''}. Nothing more was changed.`
    case 'limit':
      return 'Stopped after the maximum number of rounds. Look at the result and describe what is still missing.'
    case 'error':
      return `Failed: ${outcome.message}`
  }
}

/** Runs one instruction to the end; the panel shows every step as it happens. */
export async function startJob(instruction: string) {
  const transport = aiTransport()
  const editor = useStore.getState()
  const project = editor.project
  if (!transport || !project || useAiStore.getState().running) return
  const controller = new AbortController()
  // A conversation belongs to one set; switching sets starts a fresh one.
  if (useAiStore.getState().setId !== project.set.id) useAiStore.setState({ ...EMPTY, setId: project.set.id })
  const ai = useAiStore.getState()
  const tools = ai.tools ?? apiTools({ remember: canRemember(editor) })
  const guidelines = ai.tools ? ai.guidelines : (editor.projectStore?.guidelines?.() ?? '')
  const append = (entry: LogEntry) => useAiStore.setState((s) => ({ log: [...s.log, entry] }))
  useAiStore.setState({ tools, guidelines, running: controller })
  append({ kind: 'instruction', text: instruction })
  const jobId = crypto.randomUUID()
  const selected = editor.selectedId ? `; tile "${editor.selectedId}" is selected` : ''
  const result = await runJob({
    transport,
    host: editorHost(`ai:${jobId}`),
    jobId,
    history: ai.messages,
    instruction,
    context: `Open set "${project.set.id}" (${project.set.purpose === 'studio' ? 'studio' : 'store'} set). The editor shows locale "${editor.localeId}" and target "${editor.targetId}"${selected}.`,
    guidelines,
    tools,
    defaults: { set: project.set.id, locale: editor.localeId, target: editor.targetId },
    signal: controller.signal,
    onStep: (step) =>
      useAiStore.setState((s) => {
        const at = s.log.findIndex((e) => e.kind === 'step' && e.step.id === step.id)
        if (at < 0) return { log: [...s.log, { kind: 'step', step }] }
        const log = [...s.log]
        log[at] = { kind: 'step', step }
        return { log }
      }),
    onText: (text) => append({ kind: 'note', text }),
  })
  try {
    await flushSave()
  } catch (error) {
    append({ kind: 'saveFailed', message: error instanceof Error ? error.message : String(error) })
  }
  useAiStore.setState((s) => ({
    messages: result.messages,
    running: null,
    log: [...s.log, { kind: 'outcome', outcome: result.outcome }],
    tokens: {
      input: s.tokens.input + result.usage.input_tokens + result.usage.cache_creation_input_tokens,
      output: s.tokens.output + result.usage.output_tokens,
      cacheRead: s.tokens.cacheRead + result.usage.cache_read_input_tokens,
    },
  }))
}
