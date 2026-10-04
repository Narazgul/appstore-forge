import { describe, expect, it, vi } from 'vitest'
import type { PreviewFile, ToolHost } from '../project/tools'
import type { Project } from '../project/types'
import { apiSchema, apiTools, echoable, EDITOR_TOOLS, resultBlocks, runJob, type ToolStep } from './agent'
import type { AgentMessage, AiTransport, ContentBlock, TurnRequest, TurnResponse } from './protocol'

const project = (): Project => ({
  set: {
    version: 1,
    id: 'feature',
    targets: [
      { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'o/{storeLocale}/{n}.png' },
    ],
    locales: [{ id: 'en', store: { appstore: 'en-US' } }],
    sources: 's/{locale}/{screen}.png',
    settings: {},
    slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
    approval: null,
  },
  copies: { en: { a: { headline: 'Hi', subhead: '' } } },
})

const PNG = { mediaType: 'image/png' as const, base64: 'iVBORw0KGgo=', width: 368, height: 800 }

function fakeHost(over: Partial<ToolHost> = {}) {
  let current = project()
  const saves: Project[] = []
  const host: ToolHost = {
    listSets: async () => ['feature'],
    load: async (id) => {
      if (id !== 'feature') throw new Error(`no set ${id}`)
      return current
    },
    save: async (p) => {
      current = p
      saves.push(p)
    },
    create: async () => {},
    check: async () => [],
    gallery: async () => ({ en: { screens: ['shot'], artwork: [] } }),
    preview: async (_id, opts): Promise<PreviewFile[]> => [
      {
        slot: 'a',
        locale: opts.locales![0],
        target: opts.targets![0],
        part: 1,
        file: 'appstore/en/a.png',
        image: PNG,
      },
    ],
    render: async () => [],
    readGuidelines: async () => null,
    writeGuidelines: async () => {},
    today: () => '2026-10-04',
    ...over,
  }
  return { host, saves, current: () => current }
}

const toolUse = (id: string, name: string, input: object): ContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
})
const turn = (
  content: ContentBlock[],
  stop_reason = 'tool_use',
  extra: Partial<TurnResponse> = {},
): TurnResponse => ({
  content,
  stop_reason,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
  ...extra,
})

/** Answers each turn from the script and keeps a copy of every request, as the endpoint saw it. */
function scripted(...turns: (TurnResponse | ((req: TurnRequest) => TurnResponse))[]) {
  const requests: TurnRequest[] = []
  const transport: AiTransport = vi.fn(async (req) => {
    requests.push(structuredClone(req))
    const next = turns.shift()
    if (!next) throw new Error('script ran out')
    return typeof next === 'function' ? next(req) : next
  })
  return { transport, requests }
}

const job = (transport: AiTransport, host: ToolHost, extra: Partial<Parameters<typeof runJob>[0]> = {}) =>
  runJob({
    transport,
    host,
    jobId: 'job-1',
    history: [],
    instruction: 'make the device bigger',
    context: 'Open set "feature".',
    guidelines: '',
    tools: apiTools({ remember: false }),
    defaults: { set: 'feature', locale: 'en', target: 'appstore' },
    signal: new AbortController().signal,
    ...extra,
  })

describe('apiSchema', () => {
  it('turns nullable into a JSON Schema type list and drops the set property at the top', () => {
    const schema = apiSchema({
      type: 'object',
      properties: {
        set: { type: 'string' },
        pair: { type: 'string', nullable: true },
        role: { type: 'string', enum: ['hero'], nullable: true },
        nested: { type: 'object', properties: { set: { type: 'string' } } },
      },
      required: ['set', 'pair'],
    })
    expect(schema.properties).toEqual({
      pair: { type: ['string', 'null'] },
      role: { type: ['string', 'null'], enum: ['hero', null] },
      nested: { type: 'object', properties: { set: { type: 'string' } } },
    })
    expect(schema.required).toEqual(['pair'])
    expect(JSON.stringify(schema)).not.toContain('nullable')
  })
})

describe('apiTools', () => {
  it('offers only the editor tools, sorted, and remember only where it can write', () => {
    const names = apiTools({ remember: true }).map((t) => t.name)
    expect(names).toEqual([...EDITOR_TOOLS].sort())
    for (const cliOnly of ['render', 'capture', 'bg_fetch', 'bg_paint', 'create_set', 'list_sets'])
      expect(names).not.toContain(cliOnly)
    expect(apiTools({ remember: false }).map((t) => t.name)).not.toContain('remember')
  })

  it('renders to the same bytes every time, so the prompt cache holds', () => {
    expect(JSON.stringify(apiTools({ remember: true }))).toBe(JSON.stringify(apiTools({ remember: true })))
  })
})

describe('echoable', () => {
  it('keeps only text before the last fallback switch and drops the marker', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: 'partial' },
      toolUse('t0', 'check', {}),
      { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
      { type: 'text', text: 'rest' },
    ]
    expect(echoable(content)).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'text', text: 'rest' },
    ])
  })

  it('leaves a turn without fallback untouched, thinking blocks included', () => {
    const content = [{ type: 'thinking', thinking: '', signature: 's' }, toolUse('t', 'check', {})]
    expect(echoable(content)).toBe(content)
  })
})

describe('resultBlocks', () => {
  it('sends rendered tiles as image blocks and keeps the base64 out of the JSON text', () => {
    const blocks = resultBlocks({ files: [{ slot: 'a', file: 'x/a.png', image: PNG }], issues: [] })
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text).not.toContain(PNG.base64)
    expect(blocks.at(-1)).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG.base64 },
    })
  })
})

describe('runJob', () => {
  it('runs the tools on the open set, shows the preview to the model and ends on its answer', async () => {
    const { host, saves, current } = fakeHost()
    const steps: ToolStep[] = []
    const { transport, requests } = scripted(
      turn([
        { type: 'thinking', thinking: '', signature: 'sig-1' },
        toolUse('t1', 'update_slot', { slot: 'a', overrides: { deviceScale: 1.2 } }),
      ]),
      turn([toolUse('t2', 'preview', { slots: ['a'] })]),
      turn([{ type: 'text', text: 'Bigger now.' }], 'end_turn'),
    )
    const result = await job(transport, host, { onStep: (s) => steps.push(s) })

    expect(result.outcome).toEqual({ kind: 'done', text: 'Bigger now.' })
    expect(saves).toHaveLength(1)
    expect(current().set.slots[0].overrides.deviceScale).toBe(1.2)
    // The thinking block goes back exactly as it came.
    expect(requests[1].messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-1' })
    const previewResult = requests[2].messages.at(-1)!.content[0]
    expect(previewResult.tool_use_id).toBe('t2')
    expect((previewResult.content as ContentBlock[]).some((b) => b.type === 'image')).toBe(true)
    expect(steps.filter((s) => s.status === 'ok').map((s) => s.name)).toEqual(['update_slot', 'preview'])
    expect(steps.find((s) => s.name === 'preview' && s.status === 'ok')!.images![0]).toMatch(
      /^data:image\/png;base64,/,
    )
    expect(result.usage.cache_read_input_tokens).toBe(300)
    expect(result.turns).toBe(3)
  })

  it('fills in the open set, and the editor locale and target for a preview', async () => {
    const preview = vi.fn(async () => [])
    const { host } = fakeHost({ preview })
    const { transport } = scripted(turn([toolUse('t1', 'preview', {})]), turn([], 'end_turn'))
    await job(transport, host)
    expect(preview).toHaveBeenCalledWith('feature', {
      slots: undefined,
      locales: ['en'],
      targets: ['appstore'],
    })
  })

  it('answers a failing tool with an error result and lets the model go on', async () => {
    const { host } = fakeHost()
    const { transport, requests } = scripted(
      turn([toolUse('t1', 'update_slot', { slot: 'nope' })]),
      turn([{ type: 'text', text: 'ok' }], 'end_turn'),
    )
    const result = await job(transport, host)
    const answer = requests[1].messages.at(-1)!.content[0]
    expect(answer).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: true })
    expect(String(answer.content)).toContain('Unknown slot')
    expect(result.outcome.kind).toBe('done')
  })

  it('refuses a tool that is not offered in the editor', async () => {
    const render = vi.fn()
    const { host } = fakeHost({ render })
    const { transport, requests } = scripted(
      turn([toolUse('t1', 'render', {})]),
      turn([{ type: 'text', text: 'ok' }], 'end_turn'),
    )
    await job(transport, host)
    expect(render).not.toHaveBeenCalled()
    expect(requests[1].messages.at(-1)!.content[0]).toMatchObject({ is_error: true })
  })

  it('stops on a refusal without running or keeping anything of that turn', async () => {
    const { host, saves } = fakeHost()
    const { transport } = scripted(
      turn([toolUse('t1', 'update_slot', { slot: 'a', overrides: { tilt: 3 } })], 'refusal', {
        stop_details: { category: 'cyber', explanation: null },
      }),
    )
    const result = await job(transport, host)
    expect(result.outcome).toEqual({ kind: 'refused', category: 'cyber', explanation: null })
    expect(saves).toHaveLength(0)
    expect(result.messages.map((m) => m.role)).toEqual(['user'])
  })

  it('cancels between tools and still answers every open tool call', async () => {
    const controller = new AbortController()
    const { host, saves } = fakeHost({
      save: async () => {
        saves.push(project())
        controller.abort()
      },
    })
    const { transport } = scripted(
      turn([
        toolUse('t1', 'update_slot', { slot: 'a', overrides: { tilt: 3 } }),
        toolUse('t2', 'update_slot', { slot: 'a', overrides: { tilt: 4 } }),
      ]),
    )
    const result = await job(transport, host, { signal: controller.signal })
    expect(result.outcome.kind).toBe('cancelled')
    expect(saves).toHaveLength(1)
    const answers = result.messages.at(-1)!.content
    expect(answers.map((b) => b.tool_use_id)).toEqual(['t1', 't2'])
    expect(answers[1]).toMatchObject({ is_error: true })
  })

  it('treats an aborted request as a cancel, not an error', async () => {
    const controller = new AbortController()
    const transport: AiTransport = async (_req, signal) => {
      controller.abort()
      expect(signal.aborted).toBe(true)
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    const result = await job(transport, fakeHost().host, { signal: controller.signal })
    expect(result.outcome.kind).toBe('cancelled')
  })

  it('reports an endpoint error in words', async () => {
    const transport: AiTransport = async () => {
      throw new Error('Auftrag zu gross')
    }
    const result = await job(transport, fakeHost().host)
    expect(result.outcome).toEqual({ kind: 'error', message: 'Auftrag zu gross' })
  })

  it('stops after the maximum number of rounds', async () => {
    const forever = () => turn([toolUse(`t${Math.random()}`, 'check', {})])
    const { transport } = scripted(forever, forever, forever)
    const result = await job(transport, fakeHost().host, { maxRounds: 3 })
    expect(result.outcome.kind).toBe('limit')
    expect(result.turns).toBe(3)
  })

  it('does not run a tool call that max_tokens cut off', async () => {
    const { host, saves } = fakeHost()
    const { transport } = scripted(turn([toolUse('t1', 'update_slot', { slot: 'a' })], 'max_tokens'))
    const result = await job(transport, host)
    expect(result.outcome.kind).toBe('error')
    expect(saves).toHaveLength(0)
    expect(result.messages.at(-1)!.role).toBe('user')
  })

  it('continues a conversation without editing what came before', async () => {
    const history: AgentMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'before' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done before' }] },
    ]
    const { transport, requests } = scripted(turn([{ type: 'text', text: 'ok' }], 'end_turn'))
    await job(transport, fakeHost().host, { history })
    expect(requests[0].messages.slice(0, 2)).toEqual(history)
    expect(requests[0].messages[2].content.map((b) => b.text)).toEqual([
      'Open set "feature".',
      'make the device bigger',
    ])
  })
})
