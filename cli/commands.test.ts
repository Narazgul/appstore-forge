import { createCanvas } from '@napi-rs/canvas'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approveCommand, checkCommand, renderCommand } from './commands'
import { CliError } from './errors'
import { readProject } from './project-io'

async function scaffold() {
  const repo = await mkdtemp(join(tmpdir(), 'forge-cmd-'))
  const dir = join(repo, 'aso')
  await mkdir(join(dir, 'copy'), { recursive: true })
  await mkdir(join(repo, 'outputs', 'en'), { recursive: true })
  const c = createCanvas(200, 400)
  c.getContext('2d').fillRect(0, 0, 200, 400)
  await writeFile(join(repo, 'outputs', 'en', 'shot.png'), c.toBuffer('image/png'))
  await writeFile(
    join(dir, 'default.json'),
    JSON.stringify({
      version: 1,
      id: 'default',
      targets: [
        { id: 'play', sizeId: 'android-phone', deviceId: 'pixel-9-pro', out: 'out/{storeLocale}/{n}.png' },
      ],
      locales: [{ id: 'en', store: { play: 'en-US' } }],
      sources: 'outputs/{locale}/{screen}.png',
      settings: {},
      slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
      approval: null,
    }),
  )
  await writeFile(join(dir, 'copy', 'en.json'), JSON.stringify({ a: { headline: 'Hi', subhead: '' } }))
  return { repo, dir }
}

describe('check', () => {
  it('reports no issues and approvalOk null when approval is not required', async () => {
    const { dir } = await scaffold()
    expect(await checkCommand({ projectDir: dir, setId: 'default', requireApproval: false })).toEqual({
      issues: [],
      approvalOk: null,
    })
  })
  it('reports approvalOk false without a stamp', async () => {
    const { dir } = await scaffold()
    expect(
      (await checkCommand({ projectDir: dir, setId: 'default', requireApproval: true })).approvalOk,
    ).toBe(false)
  })
})

describe('approve then render', () => {
  it('writes a stamp that check and render accept, and rejects after a copy change', async () => {
    const { dir, repo } = await scaffold()
    const approval = await approveCommand({ projectDir: dir, setId: 'default', by: 'hofi' })
    expect(approval.by).toBe('hofi')
    expect((await readProject(dir)).set.approval?.hash).toBe(approval.hash)
    expect(
      (await checkCommand({ projectDir: dir, setId: 'default', requireApproval: true })).approvalOk,
    ).toBe(true)
    const files = await renderCommand({ projectDir: dir, setId: 'default', requireApproval: true })
    expect(files).toEqual([join(repo, 'out/en-US/1.png')])

    await writeFile(join(dir, 'copy', 'en.json'), JSON.stringify({ a: { headline: 'Changed', subhead: '' } }))
    await expect(renderCommand({ projectDir: dir, setId: 'default', requireApproval: true })).rejects.toThrow(
      /approval/i,
    )
  })

  it('refuses to render a project with validation errors', async () => {
    const { dir } = await scaffold()
    await writeFile(join(dir, 'copy', 'en.json'), '{}')
    await expect(
      renderCommand({ projectDir: dir, setId: 'default', requireApproval: false }),
    ).rejects.toThrow(/Headline missing.*slot a.*locale en/s)
  })

  it('refuses an unknown target id with exit code 2', async () => {
    const { dir } = await scaffold()
    const failing = renderCommand({
      projectDir: dir,
      setId: 'default',
      targetIds: ['appstore'],
      requireApproval: false,
    })
    await expect(failing).rejects.toThrow(/Unknown target appstore/)
    await failing.catch((err) => expect((err as CliError).exitCode).toBe(2))
  })
})
