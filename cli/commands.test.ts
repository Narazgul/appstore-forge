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

/** A second, non-default set alongside `default.json` — its copy lives under `copy/promo/`,
 *  not `copy/`, per `_context/workflows.md` "Adding a target" / `cli/project-io.ts` `copyDir`. */
async function scaffoldSet(repo: string, dir: string, id: string) {
  await mkdir(join(dir, 'copy', id), { recursive: true })
  await writeFile(
    join(dir, `${id}.json`),
    JSON.stringify({
      version: 1,
      id,
      targets: [
        { id: 'play', sizeId: 'android-phone', deviceId: 'pixel-9-pro', out: 'out2/{storeLocale}/{n}.png' },
      ],
      locales: [{ id: 'en', store: { play: 'en-US' } }],
      sources: 'outputs/{locale}/{screen}.png',
      settings: {},
      slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
      approval: null,
    }),
  )
  await writeFile(
    join(dir, 'copy', id, 'en.json'),
    JSON.stringify({ a: { headline: 'Promo headline', subhead: '' } }),
  )
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

describe('a non-default set', () => {
  it('check finds the copy files under copy/<setId>/, not the default set’s copy/', async () => {
    const { dir, repo } = await scaffold()
    await scaffoldSet(repo, dir, 'promo')
    expect(await checkCommand({ projectDir: dir, setId: 'promo', requireApproval: false })).toEqual({
      issues: [],
      approvalOk: null,
    })
    // The default set is unaffected and still finds its own copy file.
    expect(await checkCommand({ projectDir: dir, setId: 'default', requireApproval: false })).toEqual({
      issues: [],
      approvalOk: null,
    })
  })

  it('render writes the non-default set’s own out path using its own copy', async () => {
    const { dir, repo } = await scaffold()
    await scaffoldSet(repo, dir, 'promo')
    const files = await renderCommand({ projectDir: dir, setId: 'promo', requireApproval: false })
    expect(files).toEqual([join(repo, 'out2/en-US/1.png')])
  })

  it('a missing headline in the non-default set’s own copy file is reported, not the default’s', async () => {
    const { dir, repo } = await scaffold()
    await scaffoldSet(repo, dir, 'promo')
    await writeFile(join(dir, 'copy', 'promo', 'en.json'), '{}')
    const { issues } = await checkCommand({ projectDir: dir, setId: 'promo', requireApproval: false })
    expect(issues).toContainEqual({ level: 'error', message: 'Headline missing', slot: 'a', locale: 'en' })
    // The default set's own copy file was never touched.
    expect(await checkCommand({ projectDir: dir, setId: 'default', requireApproval: false })).toEqual({
      issues: [],
      approvalOk: null,
    })
  })
})

describe('eyebrow overflow', () => {
  it('flags an eyebrow that does not fit on one line, and refuses to render it', async () => {
    const { dir } = await scaffold()
    await writeFile(
      join(dir, 'copy', 'en.json'),
      JSON.stringify({
        a: {
          headline: 'Hi',
          subhead: '',
          eyebrow: Array.from({ length: 40 }, () => 'unverhaeltnismaessig').join(' '),
        },
      }),
    )
    const { issues } = await checkCommand({ projectDir: dir, setId: 'default', requireApproval: false })
    expect(issues).toContainEqual({
      level: 'error',
      message: 'Eyebrow does not fit on one line',
      slot: 'a',
      locale: 'en',
    })
    const failing = renderCommand({ projectDir: dir, setId: 'default', requireApproval: false })
    await expect(failing).rejects.toThrow(/Eyebrow does not fit on one line/)
    await failing.catch((err) => expect((err as CliError).exitCode).toBe(2))
  })

  it('accepts a short eyebrow', async () => {
    const { dir } = await scaffold()
    await writeFile(
      join(dir, 'copy', 'en.json'),
      JSON.stringify({ a: { headline: 'Hi', subhead: '', eyebrow: 'New' } }),
    )
    expect(await checkCommand({ projectDir: dir, setId: 'default', requireApproval: false })).toEqual({
      issues: [],
      approvalOk: null,
    })
  })
})

// Play's 1080×1920 tile, measured: "Hi" on text-top sits at 0.125–0.17 of the height, 0.3 lower
// with `textOffset`; feature-wall's centred group puts "All in one" at 0.357–0.403.
describe('the headline checks measure the real text block', () => {
  async function withSticker(y: number, overrides: object, copy: object = { headline: 'Hi', subhead: '' }) {
    const { dir } = await scaffold()
    await mkdir(join(dir, 'artwork'), { recursive: true })
    await writeFile(join(dir, 'artwork', 'dot.png'), createCanvas(100, 100).toBuffer('image/png'))
    const project = await readProject(dir)
    const slot = {
      ...project.set.slots[0],
      overrides,
      elements: [{ id: 'dot', artwork: 'dot', x: 0.5, y, width: 0.1, layer: 'front' }],
    }
    await writeFile(join(dir, 'default.json'), JSON.stringify({ ...project.set, slots: [slot] }))
    await writeFile(join(dir, 'copy', 'en.json'), JSON.stringify({ a: copy }))
    const { issues } = await checkCommand({ projectDir: dir, setId: 'default', requireApproval: false })
    return { messages: issues.map((i) => i.message) }
  }
  const covers = (messages: string[]) => messages.some((m) => m.includes('may cover the headline'))

  it('follows textOffset: quiet where the headline was, a warning where it went', async () => {
    const moved = { textOffset: { dx: 0, dy: 0.3 } }
    expect(covers((await withSticker(0.12, {})).messages)).toBe(true)
    expect(covers((await withSticker(0.12, moved)).messages)).toBe(false)
    expect(covers((await withSticker(0.45, moved)).messages)).toBe(true)
  })

  it('finds a feature-wall headline where the centred group put it, not on the layout band', async () => {
    const wall = { headline: 'All in one', subhead: '', list: ['Budgets', 'Goals', 'Reports'] }
    expect(covers((await withSticker(0.38, { layout: 'feature-wall' }, wall)).messages)).toBe(true)
    expect(covers((await withSticker(0.12, { layout: 'feature-wall' }, wall)).messages)).toBe(false)
  })

  it('warns about a headline pushed off the tile', async () => {
    const { messages } = await withSticker(0.9, { textOffset: { dx: 0, dy: 0.95 } })
    expect(messages).toContain('textOffset pushes the headline entirely off the tile')
    expect(covers(messages)).toBe(false)
  })
})

// A hand-edited project file can give `extra`, `elements`, `list` or `chips` the wrong JSON shape
// (a string instead of an array, say). Before this was guarded, `eyebrowFitsChecker`/
// `listFitsChecker` built screens (and, for `list`, laid them out) ahead of `validateProject`
// itself, so a wrong type crashed with a raw TypeError — exit 1, the CLI's usage-error code —
// instead of `validateProject` reporting it cleanly through the normal exit-2 path.
describe('malformed slot or copy fields', () => {
  it('reports a clean validation error, exit 2, when a slot’s extra is not an array', async () => {
    const { dir } = await scaffold()
    const project = await readProject(dir)
    await writeFile(
      join(dir, 'default.json'),
      JSON.stringify({ ...project.set, slots: [{ ...project.set.slots[0], extra: 'oops' }] }),
    )
    const failing = renderCommand({ projectDir: dir, setId: 'default', requireApproval: false })
    await expect(failing).rejects.toThrow(/extra must be an array/)
    await failing.catch((err) => expect((err as CliError).exitCode).toBe(2))
  })

  it('reports a clean validation error, exit 2, when a slot’s elements is not an array', async () => {
    const { dir } = await scaffold()
    const project = await readProject(dir)
    await writeFile(
      join(dir, 'default.json'),
      JSON.stringify({ ...project.set, slots: [{ ...project.set.slots[0], elements: 'oops' }] }),
    )
    const failing = renderCommand({ projectDir: dir, setId: 'default', requireApproval: false })
    await expect(failing).rejects.toThrow(/elements must be an array/)
    await failing.catch((err) => expect((err as CliError).exitCode).toBe(2))
  })

  it('reports a clean validation error, exit 2, when a feature-wall list is not an array', async () => {
    const { dir } = await scaffold()
    const project = await readProject(dir)
    await writeFile(
      join(dir, 'default.json'),
      JSON.stringify({ ...project.set, settings: { ...project.set.settings, layout: 'feature-wall' } }),
    )
    await writeFile(
      join(dir, 'copy', 'en.json'),
      JSON.stringify({ a: { headline: 'Hi', subhead: '', list: 'oops' } }),
    )
    const failing = renderCommand({ projectDir: dir, setId: 'default', requireApproval: false })
    await expect(failing).rejects.toThrow(/list must be an array of strings/)
    await failing.catch((err) => expect((err as CliError).exitCode).toBe(2))
  })

  it('reports a clean validation error, exit 2, when a slot’s chips is not an object', async () => {
    const { dir } = await scaffold()
    await writeFile(
      join(dir, 'copy', 'en.json'),
      JSON.stringify({ a: { headline: 'Hi', subhead: '', chips: 'oops' } }),
    )
    const failing = renderCommand({ projectDir: dir, setId: 'default', requireApproval: false })
    await expect(failing).rejects.toThrow(/chips must be an object/)
    await failing.catch((err) => expect((err as CliError).exitCode).toBe(2))
  })
})
