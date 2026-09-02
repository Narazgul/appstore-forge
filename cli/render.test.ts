import { createCanvas } from '@napi-rs/canvas'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('fails with slot and locale when a source is missing', async () => {
    const { repo, project } = await fixture()
    project.set.slots[0].screen = 'missing'
    await expect(renderProject({ project, repoRoot: repo })).rejects.toThrow(
      /slot a.*locale en.*missing\.png/s,
    )
  })
})
