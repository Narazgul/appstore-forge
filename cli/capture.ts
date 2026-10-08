import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { CaptureOptions, CaptureResult } from '../src/project/tools'
import { CliError } from './errors'

export type Adb = (args: string[]) => Promise<Buffer>

export type CaptureNode = {
  tag?: string
  text?: string
  desc?: string
  bounds: [number, number, number, number]
}
export type CaptureNodes = { width: number; height: number; nodes: CaptureNode[] }

const DEVICE_MCP_PORT = 8765
const DEFAULT_SETTLE_MS = 1500
const SEED_TIMEOUT_MS = 5 * 60_000
const CALL_TIMEOUT_MS = 60_000
const DUMP_PATH = '/sdcard/forge-nodes.xml'
const DEFAULT_APP_PACKAGE = 'app.tinygiants.getalife.debug'
const IME_SETTLE_MS = 600
const KEYCODE_BACK = '4'

export const execAdb: Adb = (args) =>
  new Promise((done, fail) => {
    execFile('adb', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err
        ? fail(new CliError(`adb ${args.join(' ')} failed: ${stderr.toString().trim() || err.message}`, 1))
        : done(stdout),
    )
  })

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const decodeXml = (s: string) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex, dec, name) =>
    name ? ENTITIES[name.toLowerCase()] : String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec)),
  )

/** Compose reports a testTag as resource-id, optionally behind a `package:id/` prefix. */
const tagOf = (resourceId: string) => resourceId.slice(resourceId.lastIndexOf('/') + 1)

export function parseNodes(xml: string, width: number, height: number): CaptureNodes {
  const nodes: CaptureNode[] = []
  for (const [element] of xml.matchAll(/<node\b[^>]*>/g)) {
    const attrs: Record<string, string> = {}
    for (const [, key, value] of element.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[key] = decodeXml(value)
    const box = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attrs.bounds ?? '')
    if (!box) continue
    const bounds = box.slice(1).map(Number) as CaptureNode['bounds']
    if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) continue
    const node: CaptureNode = { bounds }
    const tag = attrs['resource-id'] ? tagOf(attrs['resource-id']) : ''
    if (tag) node.tag = tag
    if (attrs.text) node.text = attrs.text
    if (attrs['content-desc']) node.desc = attrs['content-desc']
    if (node.tag || node.text || node.desc) nodes.push({ ...node, bounds })
  }
  return { width, height, nodes }
}

export const pngSize = (png: Buffer) => {
  if (png.length < 24 || png.toString('latin1', 1, 4) !== 'PNG')
    throw new CliError('screencap did not return a PNG', 1)
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

const demoBroadcast = (...extras: string[]) => [
  'shell',
  'am',
  'broadcast',
  '-a',
  'com.android.systemui.demo',
  ...extras.flatMap((e) => ['-e', ...e.split(' ')]),
]

/** The status bar the store shows: 9:41, full battery, full wifi, no mobile icon, no notification icons. */
export const demoEnterCommands = (): string[][] => [
  ['shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'],
  demoBroadcast('command enter'),
  demoBroadcast('command clock', 'hhmm 0941'),
  demoBroadcast('command battery', 'level 100', 'plugged false'),
  demoBroadcast('command network', 'wifi show', 'level 4', 'fully true'),
  demoBroadcast('command network', 'mobile hide'),
  demoBroadcast('command notifications', 'visible false'),
]

export const demoExitCommands = (): string[][] => [demoBroadcast('command exit')]

type Rpc = { id?: number; result?: unknown; error?: { message?: string } }

/** Dev-MCP client for the SSE transport the app serves (GET / opens the stream, whose first
 *  `endpoint` event names the URL that takes the JSON-RPC posts; answers come back on the stream). */
export class DevMcpClient {
  private abort = new AbortController()
  private pending = new Map<number, (m: Rpc) => void>()
  private nextId = 1
  private endpoint = ''

  private constructor(
    private base: string,
    private fetchImpl: typeof fetch,
  ) {}

  static async connect(port: number, fetchImpl: typeof fetch = fetch): Promise<DevMcpClient> {
    const client = new DevMcpClient(`http://127.0.0.1:${port}/`, fetchImpl)
    await client.open()
    return client
  }

  private async open() {
    const res = await this.fetchImpl(this.base, {
      headers: { Accept: 'text/event-stream' },
      signal: this.abort.signal,
    }).catch((err: Error) => {
      throw new CliError(
        `Dev-MCP not reachable at ${this.base} (${err.message}); is the debug app running and the port forwarded?`,
        1,
      )
    })
    if (!res.ok || !res.body) throw new CliError(`Dev-MCP answered ${res.status} at ${this.base}`, 1)
    const ready = new Promise<void>((done, fail) => {
      this.pump(res.body!, done).catch(fail)
    })
    await withTimeout(ready, 10_000, 'Dev-MCP sent no endpoint event')
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'forge-capture', version: '1' },
    })
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  private async pump(body: ReadableStream<Uint8Array>, onEndpoint: () => void) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        let end: number
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          let event = 'message'
          const data: string[] = []
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
          }
          const text = data.join('\n')
          if (event === 'endpoint') {
            this.endpoint = new URL(text, this.base).toString()
            onEndpoint()
          } else if (text) {
            const message = JSON.parse(text) as Rpc
            if (message.id !== undefined) this.pending.get(message.id)?.(message)
          }
        }
      }
    } catch (err) {
      if (!this.abort.signal.aborted) throw err
    }
  }

  private async post(body: object) {
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abort.signal,
    })
    if (!res.ok) throw new CliError(`Dev-MCP rejected a request (${res.status}): ${await res.text()}`, 1)
  }

  private async request(method: string, params: object, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++
    const answer = new Promise<Rpc>((done) => this.pending.set(id, done))
    await this.post({ jsonrpc: '2.0', id, method, params })
    const message = await withTimeout(
      answer,
      timeoutMs,
      `Dev-MCP ${method} timed out after ${timeoutMs / 1000}s`,
    )
    this.pending.delete(id)
    if (message.error) throw new CliError(`Dev-MCP ${method}: ${message.error.message ?? 'error'}`, 1)
    return message.result
  }

  /** Calls one dev tool; a tool-level failure throws with the tool's own text. */
  async callTool(name: string, args: object = {}, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    const result = (await this.request('tools/call', { name, arguments: args }, timeoutMs)) as {
      isError?: boolean
      content?: { type: string; text?: string }[]
    }
    const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
    if (result.isError) throw new CliError(`${name} failed: ${text}`, 1)
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  close() {
    this.abort.abort()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new CliError(message, 1)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export type CaptureDeps = {
  adb?: Adb
  connect?: (port: number) => Promise<Pick<DevMcpClient, 'callTool' | 'close'>>
  sleep?: (ms: number) => Promise<void>
}

const shell = async (adb: Adb, ...args: string[]) => (await adb(['shell', ...args])).toString('utf8')

export const isAwake = (dumpsysPower: string) => /mWakefulness=Awake\b/.test(dumpsysPower)

export const topResumedPackage = (dumpsysActivities: string) => {
  const line =
    /topResumedActivity[=:][^\n]*/.exec(dumpsysActivities)?.[0] ??
    /mResumedActivity[=:][^\n]*/.exec(dumpsysActivities)?.[0]
  return line ? (/ ([\w.]+)\/[\w.$]+/.exec(line)?.[1] ?? undefined) : undefined
}

export const isImeShown = (dumpsysInputMethod: string) => /\bmInputShown=true\b/.test(dumpsysInputMethod)

const vaultLocked = (result: unknown) =>
  typeof result === 'object' &&
  result !== null &&
  ((result as Record<string, unknown>).vaultUnlockRequired === true ||
    (result as Record<string, unknown>).unlockRequired === true)

/** Refuses the shot unless the screen is on, the vault open and the app in front: a capture after
 *  standby once wrote the launcher of a private phone into the set. */
export async function assertReadyToShoot(
  adb: Adb,
  appPackage: string,
  steps: { tool: string; result: unknown }[],
) {
  const power = await shell(adb, 'dumpsys', 'power')
  if (!isAwake(power)) {
    const state = /mWakefulness=(\w+)/.exec(power)?.[1] ?? 'unknown'
    throw new CliError(`Screen is not on (wakefulness ${state}): wake and unlock the device first`, 1)
  }
  const locked = steps.find((s) => vaultLocked(s.result))
  if (locked) throw new CliError(`Tresor gesperrt: in der App entsperren (reported by ${locked.tool})`, 1)
  const top = topResumedPackage(await shell(adb, 'dumpsys', 'activity', 'activities'))
  if (top !== appPackage)
    throw new CliError(
      `${appPackage} is not in front (${top ?? 'no resumed activity'}); open the app, then capture again (--package for another app)`,
      1,
    )
}

/** Back only while the keyboard is up: without it, Back leaves the app. Escape does nothing on Samsung. */
export async function hideIme(adb: Adb, sleep: (ms: number) => Promise<void>) {
  if (!isImeShown(await shell(adb, 'dumpsys', 'input_method'))) return false
  await adb(['shell', 'input', 'keyevent', KEYCODE_BACK])
  await sleep(IME_SETTLE_MS)
  if (isImeShown(await shell(adb, 'dumpsys', 'input_method')))
    throw new CliError('The keyboard is still open after Back; close it by hand and capture again', 1)
  return true
}

export type DevStep = { tool: string; args: object; timeoutMs?: number }

export const stepsFor = (opts: CaptureOptions): DevStep[] => [
  ...(opts.seed
    ? [
        {
          tool: 'dev_seed_screenshot_data',
          args: opts.store ? { store: opts.store } : {},
          timeoutMs: SEED_TIMEOUT_MS,
        },
      ]
    : []),
  ...(opts.screen ? [{ tool: 'dev_goto_screen', args: { screen: opts.screen } }] : []),
  ...(opts.calls ?? []).map((c) => ({ tool: c.tool, args: c.args ?? {} })),
]

export const outPathOf = (projectDir: string, out: string) => {
  const path = isAbsolute(out) ? out : resolve(projectDir, out)
  return extname(path).toLowerCase() === '.png' ? path : `${path}.png`
}

export async function runCapture(
  projectDir: string,
  opts: CaptureOptions,
  deps: CaptureDeps = {},
): Promise<CaptureResult> {
  const serial = opts.serial ?? process.env.FORGE_ADB_SERIAL
  if (!serial) throw new CliError('A device is required: --serial <adb serial> (or FORGE_ADB_SERIAL)', 1)
  const port = opts.port ?? Number(process.env.FORGE_DEV_MCP_PORT ?? DEVICE_MCP_PORT)
  const adbRaw = deps.adb ?? execAdb
  const adb: Adb = (args) => adbRaw(['-s', serial, ...args])
  const sleep = deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)))
  const image = outPathOf(projectDir, opts.out)
  const nodesFile = image.replace(/\.png$/i, '.nodes.json')

  const steps: { tool: string; result: unknown }[] = []
  const planned = stepsFor(opts)
  if (planned.length) {
    await adb(['forward', `tcp:${port}`, `tcp:${DEVICE_MCP_PORT}`])
    const mcp = await (deps.connect ?? ((p) => DevMcpClient.connect(p)))(port)
    try {
      for (const step of planned)
        steps.push({ tool: step.tool, result: await mcp.callTool(step.tool, step.args, step.timeoutMs) })
    } finally {
      mcp.close()
    }
  }
  await sleep(opts.settleMs ?? DEFAULT_SETTLE_MS)

  const appPackage = opts.package ?? process.env.FORGE_APP_PACKAGE ?? DEFAULT_APP_PACKAGE
  await assertReadyToShoot(adb, appPackage, steps)
  if (opts.hideIme && (await hideIme(adb, sleep))) await assertReadyToShoot(adb, appPackage, steps)

  let png: Buffer
  let xml: string
  try {
    for (const command of demoEnterCommands()) await adb(command)
    await sleep(300)
    png = await adb(['exec-out', 'screencap', '-p'])
    await adb(['shell', 'uiautomator', 'dump', DUMP_PATH])
    xml = (await adb(['exec-out', 'cat', DUMP_PATH])).toString('utf8')
  } finally {
    for (const command of demoExitCommands()) await adb(command).catch(() => undefined)
  }

  const { width, height } = pngSize(png)
  const nodes = parseNodes(xml, width, height)
  await mkdir(dirname(image), { recursive: true })
  await writeFile(image, png)
  await writeFile(nodesFile, `${JSON.stringify(nodes, null, 2)}\n`)
  return { image, nodes: nodesFile, width, height, nodeCount: nodes.nodes.length, steps }
}

export function parseCaptureArgs(argv: string[]): { projectDir: string; opts: CaptureOptions } {
  const { values, tokens } = parseArgs({
    args: argv,
    tokens: true,
    options: {
      project: { type: 'string' },
      out: { type: 'string' },
      serial: { type: 'string' },
      port: { type: 'string' },
      screen: { type: 'string' },
      seed: { type: 'boolean', default: false },
      store: { type: 'string' },
      call: { type: 'string', multiple: true },
      args: { type: 'string', multiple: true },
      settle: { type: 'string' },
      'hide-ime': { type: 'boolean', default: false },
      package: { type: 'string' },
    },
  })
  if (!values.project) throw new CliError('--project <dir> is required', 1)
  if (!values.out) throw new CliError('--out <path> is required (relative to the project folder)', 1)
  if (values.store !== undefined && values.store !== 'apple' && values.store !== 'google')
    throw new CliError('--store must be apple or google', 1)
  if (values.store && !values.seed) throw new CliError('--store only goes with --seed', 1)
  const number = (flag: string, raw: string | undefined) => {
    if (raw === undefined) return undefined
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) throw new CliError(`--${flag} must be a non-negative integer`, 1)
    return n
  }
  const calls: NonNullable<CaptureOptions['calls']> = []
  for (const t of tokens) {
    if (t.kind !== 'option') continue
    if (t.name === 'call') calls.push({ tool: t.value as string })
    else if (t.name === 'args') {
      const last = calls[calls.length - 1]
      if (!last || last.args) throw new CliError('--args must follow a --call that has none yet', 1)
      let parsed: unknown
      try {
        parsed = JSON.parse(t.value as string)
      } catch (err) {
        throw new CliError(`--args is not valid JSON: ${(err as Error).message}`, 1)
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new CliError('--args must be a JSON object', 1)
      last.args = parsed as Record<string, unknown>
    }
  }
  return {
    projectDir: resolve(values.project),
    opts: {
      out: values.out,
      serial: values.serial,
      port: number('port', values.port),
      screen: values.screen,
      seed: values.seed || undefined,
      store: values.store as 'apple' | 'google' | undefined,
      calls: calls.length ? calls : undefined,
      settleMs: number('settle', values.settle),
      hideIme: values['hide-ime'] || undefined,
      package: values.package,
    },
  }
}

export async function captureCommand(argv: string[]) {
  const { projectDir, opts } = parseCaptureArgs(argv)
  const result = await runCapture(projectDir, opts)
  console.log(JSON.stringify(result, null, 2))
  return 0
}
