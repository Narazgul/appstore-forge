import { createCanvas } from '@napi-rs/canvas'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerFonts } from './fonts'
import { outFilePattern, renderProject } from './render'
import { getDevice } from '../src/presets/devices'
import { getLayout } from '../src/presets/layouts'
import { mosaicCells } from '../src/render/scene'
import type { Project, SlotSticker } from '../src/project/types'

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

const pixelAt = (buf: Buffer, x: number, y: number) => {
  const { data, width } = PNG.sync.read(buf)
  const i = (y * width + x) * 4
  return { r: data[i], g: data[i + 1], b: data[i + 2] }
}

const hasBlue = (buf: Buffer) => {
  const { data } = PNG.sync.read(buf)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] > 200) return true
  }
  return false
}

const hasMagenta = (buf: Buffer) => {
  const { data } = PNG.sync.read(buf)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] < 40 && data[i + 2] > 200) return true
  }
  return false
}

/** A single-slot, single-target/-locale set carrying one shape over a full-bleed device. */
async function shapeFixture(layer: 'behind' | 'front') {
  const { repo, project } = await fixture()
  project.set.targets = [project.set.targets[0]]
  project.set.locales = [project.set.locales[0]]
  project.set.settings = { layout: 'bleed' }
  project.set.slots = [
    {
      id: 'a',
      kind: 'screen',
      screen: 'shot',
      overrides: {},
      elements: [{ id: 'kreis', shape: 'circle', color: '#0000ff', x: 0.5, y: 0.5, width: 0.6, layer }],
    },
  ]
  return { repo, project }
}

/** A single-slot, single-target/-locale set carrying one sticker over a full-bleed device. */
async function stickerFixture(layer: 'behind' | 'front') {
  const { repo, project } = await fixture()
  await mkdir(join(repo, 'aso', 'artwork'), { recursive: true })
  const c = createCanvas(200, 200)
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'rgb(0, 255, 0)'
  ctx.fillRect(0, 0, 200, 200)
  await writeFile(join(repo, 'aso', 'artwork', 'dot.png'), c.toBuffer('image/png'))
  project.set.targets = [project.set.targets[0]]
  project.set.locales = [project.set.locales[0]]
  project.set.settings = { layout: 'bleed' }
  project.set.slots = [
    {
      id: 'a',
      kind: 'screen',
      screen: 'shot',
      overrides: {},
      elements: [{ id: 'dot', artwork: 'dot', x: 0.5, y: 0.5, width: 0.6, rotate: 0, layer, shadow: false }],
    },
  ]
  return { repo, project }
}

/** A single-slot, single-target/-locale set carrying one chip over a full-bleed device. */
async function chipFixture(layer: 'behind' | 'front') {
  const { repo, project } = await fixture()
  project.set.targets = [project.set.targets[0]]
  project.set.locales = [project.set.locales[0]]
  project.set.settings = { layout: 'bleed' }
  project.set.slots = [
    {
      id: 'a',
      kind: 'screen',
      screen: 'shot',
      overrides: {},
      elements: [{ id: 'pill', chip: true, color: '#ff00ff', x: 0.5, y: 0.5, width: 0.6, size: 0.03, layer }],
    },
  ]
  project.copies.en.a.chips = { pill: '+312 € saved' }
  return { repo, project }
}

/** A single-slot, single-target/-locale mosaic set: the slot's own `shot` (red) plus three
 *  distinctly coloured `extra` screens, so each cell can be told apart by its centre pixel. */
async function mosaicFixture() {
  const { repo, project } = await fixture()
  const cell = async (name: string, color: string) => {
    const c = createCanvas(400, 800)
    const ctx = c.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 400, 800)
    await writeFile(join(repo, 'outputs', 'en', `${name}.png`), c.toBuffer('image/png'))
  }
  await cell('cell2', '#00ff00')
  await cell('cell3', '#ffff00')
  await cell('cell4', '#ff00ff')
  project.set.targets = [project.set.targets[0]]
  project.set.locales = [project.set.locales[0]]
  project.set.settings = { layout: 'mosaic' }
  project.set.slots = [
    { id: 'a', kind: 'screen', screen: 'shot', extra: ['cell2', 'cell3', 'cell4'], overrides: {} },
  ]
  return { repo, project }
}

/** A single artwork slot (no screen, no device) carrying one sticker, sized as a Play feature graphic. */
async function artworkSlotFixture() {
  const { repo, project } = await fixture()
  await mkdir(join(repo, 'aso', 'artwork'), { recursive: true })
  const c = createCanvas(200, 200)
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'rgb(0, 255, 0)'
  ctx.fillRect(0, 0, 200, 200)
  await writeFile(join(repo, 'aso', 'artwork', 'mascot.png'), c.toBuffer('image/png'))
  project.set.targets = [
    {
      id: 'feature',
      sizeId: 'play-feature-graphic',
      deviceId: 'pixel-9-pro',
      out: 'feature/{storeLocale}/featureGraphic.png',
    },
  ]
  project.set.locales = [{ id: 'en', store: { feature: 'en-US' } }]
  project.set.settings = { layout: 'banner-right', background: { kind: 'solid', color: '#eaf2ff' } }
  project.set.slots = [
    {
      id: 'a',
      kind: 'artwork',
      overrides: {},
      elements: [{ id: 'mascot', artwork: 'mascot', x: 0.2, y: 0.6, width: 0.3, layer: 'front' }],
    },
  ]
  project.copies = { en: { a: { headline: 'GetALife', subhead: 'Digital cash stuffing' } } }
  return { repo, project }
}

describe('outFilePattern', () => {
  it('matches {n} against any digits and {storeLocale} against the literal value', () => {
    const p = outFilePattern('ios/{storeLocale}/{n}_{storeLocale}.png', 'de-DE')
    expect(p.test('3_de-DE.png')).toBe(true)
    expect(p.test('3_en-US.png')).toBe(false)
    expect(p.test('icon.png')).toBe(false)
    expect(p.test('3_de-DE.jpeg')).toBe(false)
  })

  it('matches a fixed file name literally, for a target with no {n}', () => {
    const p = outFilePattern('feature/{storeLocale}/featureGraphic.png', 'de-DE')
    expect(p.test('featureGraphic.png')).toBe(true)
    expect(p.test('featureGraphic.jpeg')).toBe(false)
    expect(p.test('icon.png')).toBe(false)
  })
})

// Full-size renders take seconds each; under a parallel full run the 5 s default is too tight.
describe('renderProject', { timeout: 30_000 }, () => {
  // Registering every face reads ~60 MB; on a cold cache that alone outlasts the first test's timeout.
  beforeAll(() => registerFonts(), 60_000)

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

  it('draws a front sticker on top of the device', async () => {
    const { repo, project } = await stickerFixture('front')
    const [file] = await renderProject({ project, repoRoot: repo })
    expect(hasGreen(await readFile(file))).toBe(true)
  })

  it('draws a behind sticker under the device, where it never reaches the export', async () => {
    const { repo, project } = await stickerFixture('behind')
    const [file] = await renderProject({ project, repoRoot: repo })
    expect(hasGreen(await readFile(file))).toBe(false)
  })

  it('fails with slot and locale when a sticker artwork file is missing', async () => {
    const { repo, project } = await stickerFixture('front')
    ;(project.set.slots[0].elements![0] as SlotSticker).artwork = 'nope'
    await expect(renderProject({ project, repoRoot: repo })).rejects.toThrow(
      /Artwork image missing for slot a, locale en.*nope\.png/s,
    )
  })

  it('leaves an unrelated file in the output folder alone', async () => {
    const { repo, project } = await fixture()
    await mkdir(join(repo, 'android/de-DE'), { recursive: true })
    await writeFile(join(repo, 'android/de-DE/icon.png'), 'not ours')
    await renderProject({ project, repoRoot: repo, targetIds: ['play'], localeIds: ['de'] })
    expect(await readFile(join(repo, 'android/de-DE/icon.png'), 'utf8')).toBe('not ours')
  })

  it('renders an artwork slot with no screen and no device, at the feature graphic size', async () => {
    const { repo, project } = await artworkSlotFixture()
    const [file] = await renderProject({ project, repoRoot: repo })
    const header = ihdr(await readFile(file))
    expect(header).toEqual({ w: 1024, h: 500, colorType: 2 })
    expect(hasGreen(await readFile(file))).toBe(true)
  })

  it('keeps a fixed-name target output stable across renders instead of stacking {n} files', async () => {
    const { repo, project } = await artworkSlotFixture()
    await renderProject({ project, repoRoot: repo })
    await renderProject({ project, repoRoot: repo })
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(join(repo, 'feature/en-US'))).toEqual(['featureGraphic.png'])
  })

  it('draws a front shape as a filled circle whose exact centre pixel is the shape color', async () => {
    const { repo, project } = await shapeFixture('front')
    const [file] = await renderProject({ project, repoRoot: repo })
    const png = await readFile(file)
    expect(pixelAt(png, 660, 1434)).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('draws a behind shape under the device, where its centre never reaches the export', async () => {
    const { repo, project } = await shapeFixture('behind')
    const [file] = await renderProject({ project, repoRoot: repo })
    const png = await readFile(file)
    expect(pixelAt(png, 660, 1434)).not.toEqual({ r: 0, g: 0, b: 255 })
  })

  it('slices a shape across a panorama seam onto the tile it actually falls on', async () => {
    const { repo, project } = await shapeFixture('front')
    project.set.targets = [{ ...project.set.targets[0], out: 'panorama/{storeLocale}/{n}.png' }]
    project.set.settings = { layout: 'panorama' }
    // Composition width is two tiles; x=0.85 puts the shape's centre well into the second one.
    project.set.slots[0].elements![0] = {
      id: 'kreis',
      shape: 'circle',
      color: '#0000ff',
      x: 0.85,
      y: 0.5,
      width: 0.3,
      layer: 'front',
    }
    const [first, second] = await renderProject({ project, repoRoot: repo })
    expect(hasBlue(await readFile(first))).toBe(false)
    expect(hasBlue(await readFile(second))).toBe(true)
  })

  it('slices a sticker across a panorama seam onto the tile it actually falls on', async () => {
    const { repo, project } = await stickerFixture('front')
    project.set.targets = [{ ...project.set.targets[0], out: 'panorama/{storeLocale}/{n}.png' }]
    project.set.settings = { layout: 'panorama' }
    // Composition width is two tiles; x=0.85 puts the sticker's centre well into the second one.
    project.set.slots[0].elements![0] = {
      id: 'dot',
      artwork: 'dot',
      x: 0.85,
      y: 0.5,
      width: 0.3,
      layer: 'front',
    }
    const [first, second] = await renderProject({ project, repoRoot: repo })
    expect(hasGreen(await readFile(first))).toBe(false)
    expect(hasGreen(await readFile(second))).toBe(true)
  })

  it('draws a front chip pill on top of the device', async () => {
    const { repo, project } = await chipFixture('front')
    const [file] = await renderProject({ project, repoRoot: repo })
    expect(hasMagenta(await readFile(file))).toBe(true)
  })

  it('draws a behind chip under the device, where it never reaches the export', async () => {
    const { repo, project } = await chipFixture('behind')
    const [file] = await renderProject({ project, repoRoot: repo })
    expect(hasMagenta(await readFile(file))).toBe(false)
  })

  it('refuses to render a chip whose text does not fit even at the shrink floor', async () => {
    const { repo, project } = await chipFixture('front')
    project.set.slots[0].elements![0] = {
      id: 'pill',
      chip: true,
      color: '#ff00ff',
      x: 0.5,
      y: 0.5,
      width: 0.02,
      size: 0.03,
      layer: 'front',
    }
    project.copies.en.a.chips = { pill: 'This chip text is far too long for such a narrow pill' }
    await expect(renderProject({ project, repoRoot: repo })).rejects.toThrow(
      /Chip text does not fit for slot a, chip pill, locale en/,
    )
  })

  it('draws every mosaic cell from its own named screen, self plus the three extra', async () => {
    const { repo, project } = await mosaicFixture()
    const [file] = await renderProject({ project, repoRoot: repo })
    const png = await readFile(file)
    const aspect = getDevice('iphone-17-pro').screenAspect
    const boxes = mosaicCells(getLayout('mosaic'), 1320, 2868, aspect, 4)
    const at = (i: number) => {
      const b = boxes[i]
      return pixelAt(png, Math.round(b.x + b.w / 2), Math.round(b.y + b.h / 2))
    }
    expect(at(0)).toEqual({ r: 255, g: 0, b: 0 }) // shot.png, en locale
    expect(at(1)).toEqual({ r: 0, g: 255, b: 0 }) // cell2
    expect(at(2)).toEqual({ r: 255, g: 255, b: 0 }) // cell3
    expect(at(3)).toEqual({ r: 255, g: 0, b: 255 }) // cell4
  })

  it('fails with slot and locale when an extra mosaic screen is missing', async () => {
    const { repo, project } = await mosaicFixture()
    project.set.slots[0].extra = ['cell2', 'missing-cell', 'cell4']
    await expect(renderProject({ project, repoRoot: repo })).rejects.toThrow(
      /slot a.*locale en.*missing-cell\.png/s,
    )
  })
})
