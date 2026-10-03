import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOLS, ToolError, inputProblems, runTool } from '../src/project/tools'
import type { Issue } from '../src/project/validate'
import { readProject, writeProject } from './project-io'
import { fileHost } from './tool'
import { toolCommand } from './toolCommand'
import type { Project } from '../src/project/types'

async function repoWithShot() {
  const repo = await mkdtemp(join(tmpdir(), 'forge-tool-'))
  await mkdir(join(repo, 'shots'), { recursive: true })
  const c = createCanvas(400, 800)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#3366ff'
  ctx.fillRect(0, 0, 400, 800)
  await writeFile(join(repo, 'shots', 'budget.png'), c.toBuffer('image/png'))
  await writeFile(join(repo, 'shots', 'goals.png'), c.toBuffer('image/png'))
  const projectDir = join(repo, 'studio')
  await mkdir(projectDir)
  return { repo, projectDir, host: fileHost(projectDir) }
}

const errors = (issues: Issue[]) => issues.filter((i) => i.level === 'error')

async function studioSet() {
  const env = await repoWithShot()
  await runTool(env.host, 'create_set', {
    set: 'ratgeber',
    locales: ['de'],
    targets: [{ id: 'web', sizeId: 'studio-4x5', out: 'img/ratgeber/{n}.webp' }],
    sources: 'shots/{screen}.png',
  })
  return env
}

describe('every tool', () => {
  it('has a unique name, a description and an object schema', () => {
    const names = TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.input.type).toBe('object')
    }
  })
})

describe('inputProblems', () => {
  const schema = TOOLS.find((t) => t.name === 'update_slot')!.input
  it('names a missing required field, a wrong type, an unknown field and a bad enum', () => {
    expect(inputProblems(schema, {})).toEqual(['input.slot is required'])
    expect(inputProblems(schema, { slot: 3 })).toEqual(['input.slot must be a string'])
    expect(inputProblems(schema, { slot: 'a', nope: 1 })).toEqual(['input.nope is not a known field'])
    expect(inputProblems(schema, { slot: 'a', role: 'boss' })[0]).toMatch(/must be one of/)
  })
  it('accepts null only where a field may be dropped', () => {
    expect(inputProblems(schema, { slot: 'a', pair: null })).toEqual([])
    expect(inputProblems(schema, { slot: 'a', screen: null })).toEqual(['input.screen must not be null'])
  })
})

describe('a studio set built only through the tools', () => {
  it('needs no store code, no headline and no stamp, and renders WebP at 4:5', async () => {
    const { repo, projectDir, host } = await studioSet()
    const added = (await runTool(host, 'add_slot', {
      set: 'ratgeber',
      slot: 'schritt-1',
      screen: 'budget',
    })) as {
      slot: string
      issues: Issue[]
    }
    expect(added.slot).toBe('schritt-1')
    expect(errors(added.issues)).toEqual([])

    const project = await readProject(projectDir, 'ratgeber')
    expect(project.set.purpose).toBe('studio')
    expect(project.set.locales).toEqual([{ id: 'de' }])

    const { files } = (await runTool(host, 'render', { set: 'ratgeber', requireApproval: true })) as {
      files: string[]
    }
    expect(files).toEqual([join(repo, 'img/ratgeber/1.webp')])
    const bytes = await readFile(files[0])
    expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
    const img = await loadImage(bytes)
    expect([img.width, img.height]).toEqual([1080, 1350])
  })

  it('previews as PNG named after the slot, outside the repo, and writes nothing to out', async () => {
    const { repo, host } = await studioSet()
    await runTool(host, 'add_slot', { set: 'ratgeber', slot: 'eins', screen: 'budget' })
    await runTool(host, 'add_slot', { set: 'ratgeber', slot: 'zwei', screen: 'goals' })
    const { files } = (await runTool(host, 'preview', { set: 'ratgeber', slots: ['zwei'] })) as {
      files: { slot: string; file: string }[]
    }
    expect(files.map((f) => f.slot)).toEqual(['zwei'])
    expect(files[0].file.endsWith('/de/zwei.png')).toBe(true)
    expect(files[0].file.startsWith(repo)).toBe(false)
    expect(existsSync(files[0].file)).toBe(true)
    expect(existsSync(join(repo, 'img'))).toBe(false)
  })

  it('patches overrides with null as "inherit again" and copy field by field', async () => {
    const { projectDir, host } = await studioSet()
    await runTool(host, 'add_slot', { set: 'ratgeber', slot: 'a', screen: 'budget', overrides: { tilt: 4 } })
    await runTool(host, 'update_slot', {
      set: 'ratgeber',
      slot: 'a',
      overrides: { tilt: null, layout: 'hero' },
    })
    await runTool(host, 'set_copy', { set: 'ratgeber', locale: 'de', slot: 'a', headline: 'Ziel *setzen*' })
    await runTool(host, 'set_copy', { set: 'ratgeber', locale: 'de', slot: 'a', subhead: 'Schritt 1' })
    const project = await readProject(projectDir, 'ratgeber')
    expect(project.set.slots[0].overrides).toEqual({ layout: 'hero' })
    expect(project.copies.de.a).toEqual({ headline: 'Ziel *setzen*', subhead: 'Schritt 1' })
  })

  it('adds, moves and removes an element, a chip with its text', async () => {
    const { projectDir, host } = await studioSet()
    await runTool(host, 'add_slot', { set: 'ratgeber', slot: 'a', screen: 'budget' })
    const { element } = (await runTool(host, 'add_element', {
      set: 'ratgeber',
      slot: 'a',
      element: { chip: true, x: 0.5, y: 0.2, width: 0.5 },
      chipText: { de: '+312 €' },
    })) as { element: string }
    expect(element).toBe('chip')
    await runTool(host, 'update_element', { set: 'ratgeber', slot: 'a', element: 'chip', patch: { x: 0.3 } })
    let project = await readProject(projectDir, 'ratgeber')
    expect(project.set.slots[0].elements).toEqual([{ id: 'chip', chip: true, x: 0.3, y: 0.2, width: 0.5 }])
    expect(project.copies.de.a.chips).toEqual({ chip: '+312 €' })
    await runTool(host, 'remove_element', { set: 'ratgeber', slot: 'a', element: 'chip' })
    project = await readProject(projectDir, 'ratgeber')
    expect(project.set.slots[0].elements).toBeUndefined()
    expect(project.copies.de.a?.chips).toBeUndefined()
  })

  it('refuses an unknown slot, locale or tool with a ToolError naming what exists', async () => {
    const { host } = await studioSet()
    await expect(runTool(host, 'update_slot', { set: 'ratgeber', slot: 'x' })).rejects.toThrow(ToolError)
    await expect(
      runTool(host, 'set_copy', { set: 'ratgeber', locale: 'fr', slot: 'x', headline: 'a' }),
    ).rejects.toThrow(/Unknown locale "fr".*locales: de/)
    await expect(runTool(host, 'nope', {})).rejects.toThrow(/Unknown tool/)
  })

  it('never overwrites a set on create', async () => {
    const { host } = await studioSet()
    await expect(
      runTool(host, 'create_set', {
        set: 'ratgeber',
        locales: ['de'],
        targets: [{ id: 'web', sizeId: 'studio-4x5', out: 'x/{n}.png' }],
        sources: 'shots/{screen}.png',
      }),
    ).rejects.toThrow(/exists already/)
  })
})

describe('guidelines', () => {
  it('start with a header and gain one dated line per remember', async () => {
    const { projectDir, host } = await repoWithShot()
    expect(await runTool(host, 'guidelines', {})).toEqual({ guidelines: '' })
    await runTool(host, 'remember', { rule: 'Ratgeber-Bilder immer auf der Wiese' })
    await runTool(host, 'remember', { rule: 'Lupe direkt über dem Detail' })
    const text = await readFile(join(projectDir, 'guidelines.md'), 'utf8')
    const lines = text.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^- \d{4}-\d{2}-\d{2}: Ratgeber-Bilder immer auf der Wiese$/)
    expect(text.startsWith('# Guidelines\n\n')).toBe(true)
  })
  it('refuse a multi-line rule', async () => {
    const { host } = await repoWithShot()
    await expect(runTool(host, 'remember', { rule: 'a\nb' })).rejects.toThrow(ToolError)
  })
})

describe('studio validation', () => {
  const base = async (patch: (p: Project) => void) => {
    const { projectDir, host } = await studioSet()
    await runTool(host, 'add_slot', { set: 'ratgeber', slot: 'a', screen: 'budget' })
    const project = await readProject(projectDir, 'ratgeber')
    patch(project)
    await writeProject(projectDir, project)
    return errors(await host.check('ratgeber')).map((i) => i.message)
  }
  it('lets a store set write no WebP and demand a store code', async () => {
    expect(
      await base((p) => {
        delete p.set.purpose
      }),
    ).toEqual([
      'Target web: the stores take no WebP; only a studio set writes it',
      'No store locale for target web',
      'Headline missing',
    ])
  })
  it('needs {locale} in out once a studio set has two locales', async () => {
    expect(
      await base((p) => {
        p.set.locales.push({ id: 'en' })
      }),
    ).toEqual(['Target web: out must contain {locale} when the set has more than one locale'])
  })
  it('rejects an unknown purpose and an unknown file type', async () => {
    expect(
      await base((p) => {
        ;(p.set as { purpose: string }).purpose = 'poster'
        p.set.targets[0].out = 'img/{n}.jpg'
      }),
    ).toEqual([
      'Unknown purpose "poster"',
      'Target web: out must end in .png or .webp',
      'No store locale for target web',
      'Headline missing',
    ])
  })
})

describe('forge tool', () => {
  it('prints the catalogue without a name and an error object for a refused call', async () => {
    const { projectDir } = await repoWithShot()
    const out: string[] = []
    const log = console.log
    console.log = (s: string) => out.push(s)
    try {
      expect(await toolCommand({ projectDir, name: null })).toBe(0)
      expect(await toolCommand({ projectDir, name: 'get_set', json: '{"set":"missing"}' })).toBe(2)
    } finally {
      console.log = log
    }
    expect(JSON.parse(out[0]).tools.length).toBe(TOOLS.length)
    expect(JSON.parse(out[1]).error).toMatch(/missing/)
  })
})
