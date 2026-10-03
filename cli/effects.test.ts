import { createCanvas } from '@napi-rs/canvas'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ToolError, runTool } from '../src/project/tools'
import type { Issue } from '../src/project/validate'
import { checkCommand, renderCommand } from './commands'
import { fileHost } from './tool'

async function studioWithCapture() {
  const repo = await mkdtemp(join(tmpdir(), 'forge-effects-'))
  await mkdir(join(repo, 'shots'), { recursive: true })
  const c = createCanvas(400, 800)
  const ctx = c.getContext('2d')
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `hsl(${i * 45}, 70%, 50%)`
    ctx.fillRect(0, i * 100, 400, 100)
  }
  await writeFile(join(repo, 'shots', 'budget.png'), c.toBuffer('image/png'))
  const projectDir = join(repo, 'studio')
  await mkdir(projectDir)
  const host = fileHost(projectDir)
  await runTool(host, 'create_set', {
    set: 'ratgeber',
    locales: ['de'],
    targets: [{ id: 'web', sizeId: 'studio-4x5', out: 'img/{n}.png' }],
    sources: 'shots/{screen}.png',
  })
  await runTool(host, 'add_slot', { set: 'ratgeber', slot: 'a', screen: 'budget' })
  return { repo, projectDir, host }
}

const errors = (issues: Issue[]) => issues.filter((i) => i.level === 'error').map((i) => i.message)

describe('effects through the tools and the CLI', () => {
  it('add_element takes an effect without a position, and a placed element still needs one', async () => {
    const { host } = await studioWithCapture()
    const added = (await runTool(host, 'add_element', {
      set: 'ratgeber',
      slot: 'a',
      element: { effect: 'lift', node: 'balance' },
    })) as { element: string; issues: Issue[] }
    expect(added.element).toBe('lift')
    expect(errors(added.issues)).toEqual(['Nodes file missing: shots/budget.nodes.json'])
    await expect(
      runTool(host, 'add_element', {
        set: 'ratgeber',
        slot: 'a',
        element: { shape: 'circle', color: '#fff' },
      }),
    ).rejects.toThrow(ToolError)
  })

  it('a node resolves from the capture, renders, and fails loudly once it is gone', async () => {
    const { repo, projectDir, host } = await studioWithCapture()
    const nodes = { width: 400, height: 800, nodes: [{ tag: 'balance', bounds: [0, 200, 400, 300] }] }
    await writeFile(join(repo, 'shots', 'budget.nodes.json'), JSON.stringify(nodes))
    const plain = await renderCommand({ projectDir, setId: 'ratgeber', requireApproval: false })
    const before = await readFile(plain[0])
    const result = (await runTool(host, 'add_element', {
      set: 'ratgeber',
      slot: 'a',
      element: { id: 'up', effect: 'lift', node: 'balance' },
    })) as { issues: Issue[] }
    expect(errors(result.issues)).toEqual([])
    const [file] = await renderCommand({ projectDir, setId: 'ratgeber', requireApproval: false })
    expect(Buffer.compare(before, await readFile(file))).not.toBe(0)

    await runTool(host, 'update_element', {
      set: 'ratgeber',
      slot: 'a',
      element: 'up',
      patch: { node: 'gone' },
    })
    expect(
      errors((await checkCommand({ projectDir, setId: 'ratgeber', requireApproval: false })).issues),
    ).toEqual(['Effect up: node "gone" not found by tag, text or desc'])
    await runTool(host, 'update_element', {
      set: 'ratgeber',
      slot: 'a',
      element: 'up',
      patch: { node: null, rect: { x: 0, y: 0.25, w: 1, h: 0.125 } },
    })
    const [byRect] = await renderCommand({ projectDir, setId: 'ratgeber', requireApproval: false })
    expect(Buffer.compare(before, await readFile(byRect))).not.toBe(0)
  })
})
