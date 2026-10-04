import type { AiTransport } from './protocol'

let transport: AiTransport | null = null

/** Set once by the host before the first paint; without it the editor shows no AI field. */
export function provideAiTransport(next: AiTransport | null) {
  transport = next
}

export const aiTransport = () => transport
