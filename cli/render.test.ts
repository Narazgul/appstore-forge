import { createCanvas } from '@napi-rs/canvas'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { renderProject } from './render'
import type { Project } from '../src/project/types'

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'forge-render-'))
  for (const locale of ['en', 'de']) {
    await mkdir(join(repo, 'outputs', locale), { recursive: true })
    const c = createCanvas(400, 800)
    const ctx = c.getContext('2d')
    ctx.fillStyle = locale === 'en' ? '#ff0000' : '#0000ff'
    ctx.fillRect(0, 0, 400, 800)
    await writeFile(join(repo, 'outputs', locale, 'shot.png'), c.toBuffer('image/png'))
  }
  const project: Project = {
    set: {
      version: 1,
      id: 'default',
      targets: [
        {
          id: 'appstore',
          sizeId: 'iphone-6-9',
          deviceId: 'iphone-17-pro',
          out: 'ios/{storeLocale}/{n}_{storeLocale}.png',
        },
        {
          id: 'play',
          sizeId: 'android-phone-tall',
          deviceId: 'pixel-9-pro',
          out: 'android/{storeLocale}/{n}_{storeLocale}.png',
        },
      ],
      locales: [
        { id: 'en', store: { appstore: 'en-US', play: 'en-US' } },
        { id: 'de', store: { appstore: 'de-DE', play: 'de-DE' } },
      ],
      sources: 'outputs/{locale}/{screen}.png',
      settings: { layout: 'bleed' },
      slots: [
        { id: 'a', kind: 'screen', screen: 'shot', overrides: {} },
        { id: 'b', kind: 'screen', screen: 'shot', overrides: { layout: 'panorama' } },
      ],
      approval: null,
    },
    copies: {
      en: { a: { headline: 'One *thing*', subhead: '' }, b: { headline: 'Wide', subhead: '' } },
      de: { a: { headline: 'Eins', subhead: '' }, b: { headline: 'Breit', subhead: '' } },
    },
  }
  return { repo, project }
}

const ihdr = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] })

/** A set whose single tile is a duo of the screen and a bright, half-transparent artwork. */
async function artworkFixture() {
  const { repo, project } = await fixture()
  await mkdir(join(repo, 'aso', 'artwork'), { recursive: true })
  const c = createCanvas(200, 200)
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'rgba(0, 255, 0, 0.5)'
  ctx.fillRect(0, 0, 200, 200)
  await writeFile(join(repo, 'aso', 'artwork', 'pain-points.png'), c.toBuffer('image/png'))
  project.set.targets = [project.set.targets[0]]
  project.set.locales = [project.set.locales[0]]
  project.set.settings = { layout: 'duo', background: { kind: 'solid', color: '#000000' } }
  project.set.slots = [
    {
      id: 'a',
      kind: 'screen',
      screen: 'shot',
      artwork: 'pain-points',
      overrides: { positionId: 'duo-artwork' },
    },
  ]
  return { repo, project }
}

const hasGreen = (buf: Buffer) => {
  const { data } = PNG.sync.read(buf)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 40 && data[i + 1] > 90 && data[i + 2] < 40) return true
  }
  return false
}

describe('renderProject', () => {
  it('writes RGB PNGs at the target size for every locale, slicing panoramas into tiles', async () => {
    const { repo, project } = await fixture()
    const files = await renderProject({ project, repoRoot: repo })
    expect(files.length).toBe(2 * 2 * 3)
    const ios = ihdr(await readFile(join(repo, 'ios/de-DE/1_de-DE.png')))
    expect(ios).toEqual({ w: 1320, h: 2868, colorType: 2 })
    const play = ihdr(await readFile(join(repo, 'android/en-US/3_en-US.png')))
    expect(play).toEqual({ w: 1080, h: 2400, colorType: 2 })
  })

  it('renders only the requested target and locale', async () => {
    const { repo, project } = await fixture()
    const files = await renderProject({ project, repoRoot: repo, targetIds: ['play'], localeIds: ['de'] })
    expect(files).toEqual([
      join(repo, 'android/de-DE/1_de-DE.png'),
      join(repo, 'android/de-DE/2_de-DE.png'),
      join(repo, 'android/de-DE/3_de-DE.png'),
    ])
  })

  it('removes stale PNGs from a target folder before writing', async () => {
    const { repo, project } = await fixture()
    await mkdir(join(repo, 'android/de-DE'), { recursive: true })
    await writeFile(join(repo, 'android/de-DE/9_de-DE.png'), 'old')
    await renderProject({ project, repoRoot: repo, targetIds: ['play'], localeIds: ['de'] })
    await expect(readFile(join(repo, 'android/de-DE/9_de-DE.png'))).rejects.toThrow()
  })

  it('keeps files from an earlier locale when two locales share an output folder', async () => {
    const { repo, project } = await fixture()
    for (const target of project.set.targets) target.out = 'shared/{n}_{storeLocale}.png'
    await renderProject({ project, repoRoot: repo, targetIds: ['play'] })
    expect(await readFile(join(repo, 'shared/1_en-US.png'))).toBeTruthy()
    expect(await readFile(join(repo, 'shared/1_de-DE.png'))).toBeTruthy()
  })

  it('fails when a requested target or locale is unknown', async () => {
    const { repo, project } = await fixture()
    await expect(renderProject({ project, repoRoot: repo, targetIds: ['nope'] })).rejects.toThrow(
      /Unknown target nope/,
    )
    await expect(renderProject({ project, repoRoot: repo, localeIds: ['xx'] })).rejects.toThrow(
      /Unknown locale xx/,
    )
  })

  it('refuses to render copy that only fits by shrinking past the floor', async () => {
    const { repo, project } = await fixture()
    project.copies.en.a.headline = Array.from({ length: 60 }, () => 'unverhaeltnismaessig').join(' ')
    await expect(renderProject({ project, repoRoot: repo })).rejects.toThrow(
      /Headline does not fit for slot a, locale en/,
    )
  })

  it('fails with slot and locale when a source is missing', async () => {
    const { repo, project } = await fixture()
    project.set.slots[0].screen = 'missing'
    await expect(renderProject({ project, repoRoot: repo })).rejects.toThrow(
      /slot a.*locale en.*missing\.png/s,
    )
  })

  it('loads the slot artwork and draws it into the tile, alpha and all', async () => {
    const { repo, project } = await artworkFixture()
    const [file] = await renderProject({ project, repoRoot: repo })
    expect(hasGreen(await readFile(file))).toBe(true)
  })

  it('leaves the artwork out when the arrangement does not ask for one', async () => {
    const { repo, project } = await artworkFixture()
    project.set.slots[0].overrides = { positionId: 'center' }
    const [file] = await renderProject({ project, repoRoot: repo })
    expect(hasGreen(await readFile(file))).toBe(false)
  })

  it('fails with slot and locale when the artwork file is missing', async () => {
    const { repo, project } = await artworkFixture()
    project.set.slots[0].artwork = 'nope'
    await expect(renderProject({ project, repoRoot: repo })).rejects.toThrow(
      /Artwork image missing for slot a, locale en.*nope\.png/s,
    )
  })

  it('draws the named pair in the next frame instead of the neighbouring slot', async () => {
    const { repo, project } = await fixture()
    await mkdir(join(repo, 'outputs', 'en'), { recursive: true })
    const c = createCanvas(400, 800)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(0, 0, 400, 800)
    await writeFile(join(repo, 'outputs', 'en', 'accounts.png'), c.toBuffer('image/png'))
    project.set.targets = [project.set.targets[0]]
    project.set.locales = [project.set.locales[0]]
    project.set.settings = { layout: 'duo' }
    project.set.slots = [
      { id: 'a', kind: 'screen', screen: 'shot', pair: 'accounts', overrides: { positionId: 'duo' } },
    ]
    const [file] = await renderProject({ project, repoRoot: repo })
    expect(hasGreen(await readFile(file))).toBe(true)
  })

  it('fails when the paired screen has no source', async () => {
    const { repo, project } = await fixture()
    project.set.slots[0].pair = 'missing'
    await expect(renderProject({ project, repoRoot: repo })).rejects.toThrow(
      /slot a.*locale en.*missing\.png/s,
    )
  })
})
