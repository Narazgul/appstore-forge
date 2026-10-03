import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DevMcpClient,
  demoEnterCommands,
  demoExitCommands,
  parseCaptureArgs,
  parseNodes,
  runCapture,
  stepsFor,
  type Adb,
} from './capture'

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="app.x" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="Notgroschen &amp; Co" resource-id="app.x:id/emergency_bar" content-desc="" bounds="[40,300][1040,420]" />
    <node index="1" text="" resource-id="plain_tag" content-desc="Zurück" bounds="[0,100][120,220]" />
    <node index="2" text="Leer" resource-id="" content-desc="" bounds="[10,10][10,50]" />
    <node index="3" text="" resource-id="" content-desc="" bounds="[0,500][100,600]" />
    <node index="4" text="Zeile&#10;zwei" resource-id="a/b/tag" content-desc="" bounds="[5,600][105,700]" />
  </node>
</hierarchy>`

describe('parseNodes', () => {
  it('keeps nodes with a tag, text or description and an area, in dump order', () => {
    expect(parseNodes(XML, 1080, 2400)).toEqual({
      width: 1080,
      height: 2400,
      nodes: [
        { tag: 'emergency_bar', text: 'Notgroschen & Co', bounds: [40, 300, 1040, 420] },
        { tag: 'plain_tag', desc: 'Zurück', bounds: [0, 100, 120, 220] },
        { tag: 'tag', text: 'Zeile\nzwei', bounds: [5, 600, 105, 700] },
      ],
    })
  })
})

describe('parseCaptureArgs', () => {
  it('reads the flags and pairs each --args with the --call before it', () => {
    const { projectDir, opts } = parseCaptureArgs([
      '--project',
      '/p',
      '--out',
      'shots/a',
      '--serial',
      'emulator-5554',
      '--port',
      '8770',
      '--screen',
      'budget',
      '--seed',
      '--store',
      'google',
      '--call',
      'dev_set_format',
      '--args',
      '{"a":1}',
      '--call',
      'dev_check_in',
      '--settle',
      '800',
    ])
    expect(projectDir).toBe('/p')
    expect(opts).toEqual({
      out: 'shots/a',
      serial: 'emulator-5554',
      port: 8770,
      screen: 'budget',
      seed: true,
      store: 'google',
      calls: [{ tool: 'dev_set_format', args: { a: 1 } }, { tool: 'dev_check_in' }],
      settleMs: 800,
    })
  })
  it('refuses missing out, a stray --args, a store without seed and non-object args', () => {
    expect(() => parseCaptureArgs(['--project', '/p'])).toThrow(/--out/)
    expect(() => parseCaptureArgs(['--project', '/p', '--out', 'a', '--args', '{}'])).toThrow(/--call/)
    expect(() => parseCaptureArgs(['--project', '/p', '--out', 'a', '--store', 'apple'])).toThrow(/--seed/)
    expect(() => parseCaptureArgs(['--project', '/p', '--out', 'a', '--call', 't', '--args', '[]'])).toThrow(
      /object/,
    )
    expect(() => parseCaptureArgs(['--project', '/p', '--out', 'a', '--store', 'x', '--seed'])).toThrow(
      /apple or google/,
    )
  })
})

describe('stepsFor', () => {
  it('seeds first with the long timeout, then goes to the screen, then the extra calls', () => {
    const steps = stepsFor({
      out: 'a',
      seed: true,
      store: 'apple',
      screen: 'budget',
      calls: [{ tool: 'x', args: { k: 1 } }],
    })
    expect(steps.map((s) => s.tool)).toEqual(['dev_seed_screenshot_data', 'dev_goto_screen', 'x'])
    expect(steps[0]).toMatchObject({ args: { store: 'apple' }, timeoutMs: 300_000 })
    expect(steps[1].args).toEqual({ screen: 'budget' })
  })
})

const pngOf = (w: number, h: number) => PNG.sync.write(new PNG({ width: w, height: h }))

function fakeAdb(log: string[][], fail?: (args: string[]) => boolean): Adb {
  return async (args) => {
    log.push(args)
    if (fail?.(args)) throw new Error('boom')
    if (args.includes('screencap')) return pngOf(1080, 2400)
    if (args.includes('cat')) return Buffer.from(XML)
    return Buffer.alloc(0)
  }
}

describe('demo mode', () => {
  it('enters with 9:41, full battery and signal, no notifications, and exits', () => {
    const flat = demoEnterCommands().map((c) => c.join(' '))
    expect(flat[0]).toBe('shell settings put global sysui_demo_allowed 1')
    expect(flat).toContain('shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941')
    expect(flat).toContain(
      'shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false',
    )
    expect(flat).toContain(
      'shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false',
    )
    expect(flat.filter((c) => c.includes('command network'))).toHaveLength(2)
    expect(demoExitCommands().map((c) => c.join(' '))).toEqual([
      'shell am broadcast -a com.android.systemui.demo -e command exit',
    ])
  })
})

describe('runCapture', () => {
  const noSleep = async () => undefined
  const mcpCalls: [string, object, number | undefined][] = []
  const connect = async () => ({
    callTool: async (name: string, args: object, timeoutMs?: number) => {
      mcpCalls.push([name, args, timeoutMs])
      return { ok: true }
    },
    close: () => undefined,
  })

  it('shoots between demo enter and exit, always with -s, and writes the png and nodes.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-capture-'))
    const log: string[][] = []
    const result = await runCapture(
      dir,
      { out: 'shots/budget', serial: 'dev1', screen: 'budget' },
      { adb: fakeAdb(log), connect, sleep: noSleep },
    )
    expect(log.every((a) => a[0] === '-s' && a[1] === 'dev1')).toBe(true)
    const flat = log.map((a) => a.slice(2).join(' '))
    expect(flat[0]).toBe('forward tcp:8765 tcp:8765')
    expect(flat.indexOf('exec-out screencap -p')).toBeGreaterThan(
      flat.findIndex((c) => c.includes('command clock')),
    )
    expect(flat.at(-1)).toContain('command exit')
    expect(mcpCalls.at(-1)).toEqual(['dev_goto_screen', { screen: 'budget' }, undefined])
    expect(result).toMatchObject({
      width: 1080,
      height: 2400,
      nodeCount: 3,
      image: join(dir, 'shots/budget.png'),
    })
    expect(JSON.parse(await readFile(join(dir, 'shots/budget.nodes.json'), 'utf8')).nodes).toHaveLength(3)
    expect((await readFile(join(dir, 'shots/budget.png'))).subarray(1, 4).toString()).toBe('PNG')
  })

  it('leaves the demo mode even when the shot fails, and writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-capture-'))
    const log: string[][] = []
    await expect(
      runCapture(
        dir,
        { out: 'a.png', serial: 'dev1' },
        { adb: fakeAdb(log, (a) => a.includes('screencap')), sleep: noSleep },
      ),
    ).rejects.toThrow('boom')
    expect(log.at(-1)!.join(' ')).toContain('command exit')
    expect(log.some((a) => a.includes('forward'))).toBe(false)
  })

  it('needs a device', async () => {
    delete process.env.FORGE_ADB_SERIAL
    await expect(runCapture('/x', { out: 'a' }, { adb: fakeAdb([]) })).rejects.toThrow(/--serial/)
  })
})

describe('DevMcpClient', () => {
  let server: Server | undefined
  afterEach(() => server?.close())

  it('opens the SSE stream, initializes and gets a tool result back over the stream', async () => {
    const seen: { method: string; params?: { name?: string; arguments?: unknown } }[] = []
    let stream: import('node:http').ServerResponse | undefined
    server = createServer((req, res) => {
      if (req.method === 'GET') {
        stream = res
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('event: endpoint\ndata: /message?sessionId=s1\n\n')
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const msg = JSON.parse(body)
        seen.push(msg)
        res.writeHead(202).end('Accepted')
        if (msg.id === undefined) return
        const result =
          msg.method === 'initialize'
            ? { protocolVersion: '2024-11-05', capabilities: {} }
            : { content: [{ type: 'text', text: JSON.stringify({ went: msg.params.arguments }) }] }
        stream!.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`)
      })
    })
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
    const client = await DevMcpClient.connect((server.address() as AddressInfo).port)
    expect(await client.callTool('dev_goto_screen', { screen: 'budget' })).toEqual({
      went: { screen: 'budget' },
    })
    client.close()
    expect(seen.map((m) => m.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    expect(seen[2].params?.name).toBe('dev_goto_screen')
  })
})
