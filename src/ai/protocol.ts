/**
 * What the editor and a host's AI endpoint exchange for one model turn. The endpoint is a thin
 * proxy: it owns model, system prompt and limits; the editor owns the conversation and runs the
 * tools on the open set. Blocks are the Messages API's own shapes, passed through untouched —
 * thinking blocks in particular must come back byte for byte.
 */

export type ContentBlock = { type: string; [key: string]: unknown }

export type AgentMessage = { role: 'user' | 'assistant'; content: ContentBlock[] }

export type ApiTool = { name: string; description: string; input_schema: Record<string, unknown> }

export type TurnRequest = {
  /** one id per job (one instruction and the turns it takes), for the endpoint's limits */
  jobId: string
  messages: AgentMessage[]
  tools: ApiTool[]
  /** the project's design rules, the same text for every turn of a conversation */
  guidelines: string
}

export type TurnUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export type TurnResponse = {
  content: ContentBlock[]
  stop_reason: string | null
  stop_details?: { category?: string | null; explanation?: string | null } | null
  usage?: TurnUsage
  model?: string
}

/** Sends one turn; rejects with an `AiEndpointError` when the endpoint refuses or fails. */
export type AiTransport = (request: TurnRequest, signal: AbortSignal) => Promise<TurnResponse>

export class AiEndpointError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** The plain fetch transport against a same-origin endpoint behind the host's login. */
export function fetchTransport(endpoint: string): AiTransport {
  return async (request, signal) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(request),
      signal,
    })
    const body = (await res.json().catch(() => null)) as (TurnResponse & { error?: string }) | null
    if (!res.ok || !body) throw new AiEndpointError(body?.error ?? `HTTP ${res.status}`, res.status)
    return body
  }
}
