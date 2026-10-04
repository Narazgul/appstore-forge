import { getTool, runTool, type JsonSchema, type PreviewFile, type ToolHost } from '../project/tools'
import type { AgentMessage, AiTransport, ApiTool, ContentBlock } from './protocol'

/**
 * The tools the editor offers a model: everything that works on the one open set. Left out are
 * the ones needing a file system, a device or the network (render, capture, bg_fetch, bg_paint)
 * and the ones reaching beyond the open set (list_sets, create_set). The endpoint keeps the same
 * list as its allowlist.
 */
export const EDITOR_TOOLS = [
  'add_element',
  'add_slot',
  'check',
  'get_set',
  'guidelines',
  'list_images',
  'list_presets',
  'preview',
  'remember',
  'remove_element',
  'remove_slot',
  'set_copy',
  'update_element',
  'update_settings',
  'update_slot',
  'update_target',
] as const

export const MAX_ROUNDS = 15

const PREVIEW_DESCRIPTION =
  'Renders tiles and shows them to you as images (about 800 px on the long side), to look at them before you finish. Default: every slot, the locale and target open in the editor.'

/** Our schemas mark "null drops this field" with `nullable`; the API wants JSON Schema's own
 *  type list. The `set` property goes: the editor only ever works on the set that is open. */
export function apiSchema(schema: JsonSchema, top = true): Record<string, unknown> {
  const { nullable, ...rest } = schema
  const out: Record<string, unknown> = { ...rest }
  if (nullable && rest.type) out.type = [rest.type, 'null']
  if (nullable && rest.enum) out.enum = [...rest.enum, null]
  if (rest.description === '') delete out.description
  if (rest.items) out.items = apiSchema(rest.items, false)
  if (rest.properties) {
    const properties = Object.entries(rest.properties).filter(([key]) => !(top && key === 'set'))
    out.properties = Object.fromEntries(properties.map(([key, sub]) => [key, apiSchema(sub, false)]))
    if (rest.required) out.required = rest.required.filter((key) => !(top && key === 'set'))
  }
  return out
}

/** Sorted by name, so the list renders to the same bytes every turn and the prompt cache holds. */
export function apiTools(opts: { remember: boolean }): ApiTool[] {
  return EDITOR_TOOLS.filter((name) => opts.remember || name !== 'remember')
    .map((name) => {
      const tool = getTool(name)!
      return {
        name,
        description: name === 'preview' ? PREVIEW_DESCRIPTION : tool.description,
        input_schema: apiSchema(tool.input),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * After a server-side fallback the blocks before the last switch point belong to the model that
 * declined; only their text may be echoed back. The marker itself is an audit note.
 */
export function echoable(content: ContentBlock[]): ContentBlock[] {
  let last = -1
  content.forEach((b, i) => {
    if (b.type === 'fallback') last = i
  })
  if (last < 0) return content
  return [...content.slice(0, last).filter((b) => b.type === 'text'), ...content.slice(last + 1)]
}

export type ToolStep = {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'ok' | 'error' | 'cancelled'
  error?: string
  /** data URLs of the tiles a preview rendered */
  images?: string[]
}

export type JobOutcome =
  | { kind: 'done'; text: string }
  | { kind: 'cancelled' }
  | { kind: 'refused'; category: string | null; explanation: string | null }
  | { kind: 'limit' }
  | { kind: 'error'; message: string }

export type JobUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type JobResult = { messages: AgentMessage[]; outcome: JobOutcome; usage: JobUsage; turns: number }

export type JobOptions = {
  transport: AiTransport
  host: ToolHost
  jobId: string
  /** the conversation so far; never edited, only appended to */
  history: AgentMessage[]
  instruction: string
  /** where the editor stands right now (set, locale, target, selected tile) */
  context: string
  guidelines: string
  tools: ApiTool[]
  /** filled into every call: the open set, and the editor's locale and target for a preview */
  defaults: { set: string; locale?: string; target?: string }
  signal: AbortSignal
  onStep?(step: ToolStep): void
  onText?(text: string): void
  maxRounds?: number
}

const textOf = (content: ContentBlock[]) =>
  content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim()

const CANCELLED = 'Cancelled by the user before this ran.'

/** A tool's answer as result blocks: rendered tiles become image blocks the model can look at,
 *  the rest stays JSON. */
export function resultBlocks(result: unknown): ContentBlock[] {
  const files = (result as { files?: PreviewFile[] } | null)?.files
  if (!Array.isArray(files) || !files.some((f) => f.image))
    return [{ type: 'text', text: JSON.stringify(result) }]
  const listed = { ...(result as object), files: files.map(({ image: _image, ...rest }) => rest) }
  const blocks: ContentBlock[] = [{ type: 'text', text: JSON.stringify(listed) }]
  for (const f of files) {
    if (!f.image) continue
    blocks.push({ type: 'text', text: `Tile ${f.file}:` })
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: f.image.mediaType, data: f.image.base64 },
    })
  }
  return blocks
}

const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError'

/**
 * One instruction, carried out: a model turn, the tools it asked for on the open set, their
 * results back, until the model answers without a tool. Stops on cancel, refusal, an endpoint
 * error or `maxRounds`; the conversation it returns always ends in a consistent state (no tool
 * call left without its result), so the next instruction can continue it.
 */
export async function runJob(opts: JobOptions): Promise<JobResult> {
  const messages: AgentMessage[] = [
    ...opts.history,
    {
      role: 'user',
      content: [
        { type: 'text', text: opts.context },
        { type: 'text', text: opts.instruction },
      ],
    },
  ]
  const usage: JobUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }
  const finish = (outcome: JobOutcome, turns: number): JobResult => ({ messages, outcome, usage, turns })
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS
  for (let turn = 1; turn <= maxRounds; turn++) {
    if (opts.signal.aborted) return finish({ kind: 'cancelled' }, turn - 1)
    let response
    try {
      response = await opts.transport(
        { jobId: opts.jobId, messages, tools: opts.tools, guidelines: opts.guidelines },
        opts.signal,
      )
    } catch (error) {
      if (opts.signal.aborted || isAbort(error)) return finish({ kind: 'cancelled' }, turn - 1)
      return finish(
        { kind: 'error', message: error instanceof Error ? error.message : String(error) },
        turn - 1,
      )
    }
    for (const key of Object.keys(usage) as (keyof typeof usage)[]) usage[key] += response.usage?.[key] ?? 0
    // A refusal can cut a tool call off mid-input: nothing of that turn runs or is kept.
    if (response.stop_reason === 'refusal')
      return finish(
        {
          kind: 'refused',
          category: response.stop_details?.category ?? null,
          explanation: response.stop_details?.explanation ?? null,
        },
        turn,
      )
    const content = echoable(response.content)
    const calls = content.filter((b) => b.type === 'tool_use')
    if (response.stop_reason === 'max_tokens' && calls.length)
      return finish(
        { kind: 'error', message: 'The answer was cut off before its tool call was complete.' },
        turn,
      )
    messages.push({ role: 'assistant', content })
    const text = textOf(content)
    if (!calls.length) return finish({ kind: 'done', text }, turn)
    if (text) opts.onText?.(text)
    const results: ContentBlock[] = []
    for (const call of calls) {
      const id = call.id as string
      const name = call.name as string
      const input: Record<string, unknown> = {
        ...((call.input as Record<string, unknown>) ?? {}),
        set: opts.defaults.set,
      }
      if (name === 'preview') {
        if (input.locale === undefined && opts.defaults.locale) input.locale = opts.defaults.locale
        if (input.target === undefined && opts.defaults.target) input.target = opts.defaults.target
      }
      const step: ToolStep = { id, name, input, status: 'running' }
      if (opts.signal.aborted) {
        opts.onStep?.({ ...step, status: 'cancelled' })
        results.push({ type: 'tool_result', tool_use_id: id, is_error: true, content: CANCELLED })
        continue
      }
      opts.onStep?.(step)
      if (!(EDITOR_TOOLS as readonly string[]).includes(name)) {
        const error = `Tool ${name} is not available in the editor`
        opts.onStep?.({ ...step, status: 'error', error })
        results.push({ type: 'tool_result', tool_use_id: id, is_error: true, content: error })
        continue
      }
      try {
        const result = await runTool(opts.host, name, input)
        const files = (result as { files?: PreviewFile[] } | null)?.files
        const images = Array.isArray(files)
          ? files.filter((f) => f.image).map((f) => `data:${f.image!.mediaType};base64,${f.image!.base64}`)
          : undefined
        opts.onStep?.({ ...step, status: 'ok', ...(images?.length ? { images } : {}) })
        results.push({ type: 'tool_result', tool_use_id: id, content: resultBlocks(result) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        opts.onStep?.({ ...step, status: 'error', error: message })
        results.push({ type: 'tool_result', tool_use_id: id, is_error: true, content: message })
      }
    }
    messages.push({ role: 'user', content: results })
    if (opts.signal.aborted) return finish({ kind: 'cancelled' }, turn)
  }
  return finish({ kind: 'limit' }, maxRounds)
}
