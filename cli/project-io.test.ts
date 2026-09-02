import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyDir, readProject, repoRootOf, writeProject } from './project-io'

const SET = {
  version: 1,
  id: 'default',
  targets: [
    { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'o/{storeLocale}/{n}.png' },
  ],
  locales: [
    { id: 'en', store: { appstore: 'en-US' } },
    { id: 'de', store: { appstore: 'de-DE' } },
  ],
  sources: 's/{locale}/{screen}.png',
  settings: {},
  slots: [{ id: 'a', kind: 'screen', screen: 'shot', overrides: {} }],
  approval: null,
}

async function scaffold() {
  const repo = await mkdtemp(join(tmpdir(), 'forge-'))
  const dir = join(repo, 'aso')
  await mkdir(join(dir, 'copy'), { recursive: true })
  await writeFile(join(dir, 'default.json'), JSON.stringify(SET))
  await writeFile(join(dir, 'copy', 'en.json'), JSON.stringify({ a: { headline: 'Hi', subhead: '' } }))
  await writeFile(join(dir, 'copy', 'de.json'), JSON.stringify({ a: { headline: 'Hallo', subhead: '' } }))
  return { repo, dir }
}

describe('readProject', () => {
  it('reads the set and one copy file per locale', async () => {
    const { dir } = await scaffold()
    const p = await readProject(dir)
    expect(p.set.id).toBe('default')
    expect(p.copies.de.a.headline).toBe('Hallo')
  })

  it('treats a missing copy file as empty copy', async () => {
    const { dir } = await scaffold()
    await writeFile(
      join(dir, 'default.json'),
      JSON.stringify({ ...SET, locales: [...SET.locales, { id: 'fr', store: { appstore: 'fr-FR' } }] }),
    )
    const p = await readProject(dir)
    expect(p.copies.fr).toEqual({})
  })
})

describe('writeProject', () => {
  it('writes pretty JSON with a trailing newline and stable key order', async () => {
    const { dir } = await scaffold()
    const p = await readProject(dir)
    p.copies.de.a.headline = 'Servus'
    await writeProject(dir, p)
    const text = await readFile(join(dir, 'copy', 'de.json'), 'utf8')
    expect(text).toBe('{\n  "a": {\n    "headline": "Servus",\n    "subhead": ""\n  }\n}\n')
  })
})

describe('paths', () => {
  it('derives the repo root and the copy dir', () => {
    expect(repoRootOf('/x/repo/aso')).toBe('/x/repo')
    expect(copyDir('/x/repo/aso', 'default')).toBe('/x/repo/aso/copy')
    expect(copyDir('/x/repo/aso', 'cpp-schulden')).toBe('/x/repo/aso/copy/cpp-schulden')
  })
})
