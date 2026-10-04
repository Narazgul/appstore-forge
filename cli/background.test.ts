import { createCanvas } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { PAINT_MODEL } from '../src/presets/paintStyles'
import { runTool } from '../src/project/tools'
import type { Background } from '../src/types'
import {
  CREDITS_FILE,
  nearestAspect,
  paintBackground,
  readCreditsFile,
  saveBackground,
  searchBackgrounds,
  trimBox,
} from './background'
import { approveCommand, checkCommand, renderCommand } from './commands'
import { fileHost } from './tool'

function pngBytes(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const c = createCanvas(w, h)
  paint(c.getContext('2d') as unknown as CanvasRenderingContext2D)
  return new Uint8Array(c.toBuffer('image/png'))
}

const meadow = () =>
  pngBytes(300, 400, (ctx) => {
    ctx.fillStyle = '#88bbee'
    ctx.fillRect(0, 0, 300, 240)
    ctx.fillStyle = '#4a7a3a'
    ctx.fillRect(0, 240, 300, 160)
  })

/** A fetch that answers from a table of URL prefixes and remembers every call. */
function fakeFetch(routes: [string, () => unknown][]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const route = routes.find(([prefix]) => url.startsWith(prefix))
    if (!route) return new Response('nope', { status: 404 })
    const body = route[1]()
    return body instanceof Uint8Array
      ? new Response(body as unknown as BodyInit)
      : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { impl, calls }
}

async function studio() {
  const repo = await mkdtemp(join(tmpdir(), 'forge-bg-'))
  await mkdir(join(repo, 'shots'), { recursive: true })
  const shot = pngBytes(400, 800, (ctx) => {
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 400, 800)
  })
  await writeFile(join(repo, 'shots', 'budget.png'), shot)
  const projectDir = join(repo, 'studio')
  await mkdir(projectDir)
  const host = fileHost(projectDir)
  await runTool(host, 'create_set', {
    set: 'probe',
    locales: ['en'],
    targets: [{ id: 'web', sizeId: 'studio-4x5', out: 'img/{n}.png' }],
    sources: 'shots/{screen}.png',
  })
  await runTool(host, 'add_slot', { set: 'probe', slot: 'a', screen: 'budget' })
  return { repo, projectDir, host }
}

const unsplashPhoto = {
  id: 'abc',
  description: null,
  alt_description: 'green meadow',
  urls: { raw: 'https://images.unsplash.com/photo-1?ixid=x' },
  links: {
    html: 'https://unsplash.com/photos/abc',
    download_location: 'https://api.unsplash.com/photos/abc/download?ixid=x',
  },
  user: { name: 'Jo Doe', links: { html: 'https://unsplash.com/@jodoe' } },
}

describe('searchBackgrounds', () => {
  it('Unsplash: searches with the key, builds credit links with utm and keeps the download location', async () => {
    const { impl, calls } = fakeFetch([
      ['https://api.unsplash.com/search/photos', () => ({ results: [unsplashPhoto] })],
    ])
    const [c] = await searchBackgrounds({
      source: 'unsplash',
      query: 'meadow',
      orientation: 'portrait',
      unsplashKey: 'KEY',
      unsplashApp: 'getalife',
      fetchImpl: impl,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('orientation=portrait')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Client-ID KEY')
    expect(c.imageUrl).toBe('https://images.unsplash.com/photo-1?ixid=x&w=2160&q=80&fm=jpg')
    expect(c.credit).toMatchObject({
      source: 'unsplash',
      author: 'Jo Doe',
      authorUrl: 'https://unsplash.com/@jodoe?utm_source=getalife&utm_medium=referral',
      url: 'https://unsplash.com/photos/abc?utm_source=getalife&utm_medium=referral',
      attribution: 'Photo by Jo Doe on Unsplash',
    })
  })

  it('Unsplash refuses without a key', async () => {
    await expect(searchBackgrounds({ source: 'unsplash', query: 'x' })).rejects.toThrow('UNSPLASH_ACCESS_KEY')
  })

  it('The Met: skips what is not public domain, has no image or no longer exists', async () => {
    const base = 'https://collectionapi.metmuseum.org/public/collection'
    const { impl } = fakeFetch([
      [`${base}/v1.1/search`, () => ({ objectIDs: [1, 2, 3, 4] })],
      [
        `${base}/v1/objects/1`,
        () => ({ objectID: 1, isPublicDomain: false, primaryImage: 'https://m/1.jpg' }),
      ],
      [`${base}/v1/objects/2`, () => ({ objectID: 2, isPublicDomain: true, primaryImage: '' })],
      [
        `${base}/v1/objects/4`,
        () => ({
          objectID: 4,
          isPublicDomain: true,
          primaryImage: 'https://m/4.jpg',
          title: 'Wheat Field',
          artistDisplayName: 'Vincent van Gogh',
          objectDate: '1889',
          objectURL: 'https://www.metmuseum.org/art/collection/search/4',
        }),
      ],
    ])
    const found = await searchBackgrounds({ source: 'met', query: 'wheat', fetchImpl: impl })
    expect(found.map((c) => c.id)).toEqual(['4'])
    expect(found[0].credit.license).toBe('CC0 (The Met Open Access)')
    expect(found[0].credit.attribution).toBe(
      'Wheat Field, Vincent van Gogh, 1889. The Metropolitan Museum of Art (CC0)',
    )
  })

  it('Art Institute of Chicago: filters on public domain and builds the IIIF link', async () => {
    const { impl, calls } = fakeFetch([
      [
        'https://api.artic.edu/api/v1/artworks/search',
        () => ({
          data: [
            { id: 1, title: 'Locked', image_id: 'x', is_public_domain: false },
            { id: 2, title: 'Ruins', artist_title: 'Ruisdael', image_id: 'img2', is_public_domain: true },
          ],
        }),
      ],
    ])
    const found = await searchBackgrounds({ source: 'aic', query: 'ruins', fetchImpl: impl })
    expect(calls[0].url).toContain('query%5Bterm%5D%5Bis_public_domain%5D=true')
    expect(found).toHaveLength(1)
    expect(found[0].imageUrl).toBe('https://www.artic.edu/iiif/2/img2/full/1686,/0/default.jpg')
    expect(found[0].credit.url).toBe('https://www.artic.edu/artworks/2')
  })
})

describe('saveBackground', () => {
  it('stores the file once, reports the Unsplash download and records the credit', async () => {
    const { repo, projectDir } = await studio()
    const { impl, calls } = fakeFetch([
      ['https://api.unsplash.com/search', () => ({ results: [unsplashPhoto] })],
      ['https://images.unsplash.com/', meadow],
      ['https://api.unsplash.com/photos/abc/download', () => ({ url: 'x' })],
    ])
    const [candidate] = await searchBackgrounds({
      source: 'unsplash',
      query: 'm',
      unsplashKey: 'K',
      fetchImpl: impl,
    })
    const saved = await saveBackground(projectDir, candidate, {
      name: 'Wiese',
      unsplashKey: 'K',
      fetchImpl: impl,
    })
    expect(saved.src).toBe('studio/hintergruende/wiese.jpg')
    expect(existsSync(join(repo, saved.src))).toBe(true)
    expect(calls.map((c) => c.url)).toContain('https://api.unsplash.com/photos/abc/download?ixid=x')
    const credits = readCreditsFile(join(projectDir, 'hintergruende'))
    expect(credits['wiese.jpg']).toMatchObject({
      source: 'unsplash',
      author: 'Jo Doe',
      average: saved.average,
    })
    expect(credits['wiese.jpg']).not.toHaveProperty('downloadLocation')
    await expect(
      saveBackground(projectDir, candidate, { name: 'Wiese', unsplashKey: 'K', fetchImpl: impl }),
    ).rejects.toThrow('exists already')
  })
})

describe('trimBox', () => {
  it('cuts a flat mount off every side and keeps the painting', () => {
    const w = 100
    const h = 80
    const lum = new Float64Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        lum[y * w + x] = x >= 6 && x < 94 && y >= 5 && y < 75 ? ((x * 7 + y * 13) % 200) + 20 : 10
    const box = trimBox(lum, w, h)
    expect(box.x).toBeGreaterThanOrEqual(6)
    expect(box.y).toBeGreaterThanOrEqual(5)
    expect(box.x + box.w).toBeLessThanOrEqual(94)
    expect(box.y + box.h).toBeLessThanOrEqual(75)
    expect(box.w).toBeGreaterThan(80)
  })
})

describe('paintBackground', () => {
  it('dry run shows model, price and request and calls nothing', async () => {
    const { repo, projectDir } = await studio()
    await mkdir(join(projectDir, 'hintergruende'))
    await writeFile(join(projectDir, 'hintergruende', 'wiese.jpg'), meadow())
    const { impl, calls } = fakeFetch([])
    const result = (await paintBackground({
      projectDir,
      file: 'studio/hintergruende/wiese.jpg',
      style: 'oil',
      dryRun: true,
      fetchImpl: impl,
    })) as { model: string; request: { aspect_ratio: string; seed: number } }
    expect(calls).toHaveLength(0)
    expect(result.model).toBe(PAINT_MODEL)
    expect(result.request).toMatchObject({ aspect_ratio: '3:4', seed: 1 })
    expect(existsSync(join(repo, 'studio/hintergruende/wiese-oil.jpg'))).toBe(false)
  })

  it('keeps the painted file next to its source with model, prompt, seed and the source credit', async () => {
    const { projectDir } = await studio()
    const dir = join(projectDir, 'hintergruende')
    await mkdir(dir)
    await writeFile(join(dir, 'wiese.jpg'), meadow())
    await writeFile(
      join(dir, CREDITS_FILE),
      JSON.stringify({ 'wiese.jpg': { source: 'unsplash', attribution: 'Photo by Jo Doe on Unsplash' } }),
    )
    const { impl, calls } = fakeFetch([
      [`https://fal.run/${PAINT_MODEL}`, () => ({ images: [{ url: 'https://fal.media/out.jpg' }], seed: 9 })],
      ['https://fal.media/out.jpg', meadow],
    ])
    const result = await paintBackground({
      projectDir,
      file: 'studio/hintergruende/wiese.jpg',
      style: 'ink',
      seed: 9,
      falKey: 'FK',
      fetchImpl: impl,
    })
    const sent = JSON.parse(String(calls[0].init?.body))
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Key FK')
    expect(sent.image_url).toMatch(/^data:image\/jpeg;base64,/)
    expect(sent.seed).toBe(9)
    expect(result.src).toBe('studio/hintergruende/wiese-ink.jpg')
    expect(readCreditsFile(dir)['wiese-ink.jpg']).toMatchObject({
      source: 'fal',
      from: 'studio/hintergruende/wiese.jpg',
      model: PAINT_MODEL,
      style: 'ink',
      seed: 9,
      attribution: 'Photo by Jo Doe on Unsplash',
      basedOn: { source: 'unsplash' },
    })
  })

  it('refuses without a key', async () => {
    const { projectDir } = await studio()
    await mkdir(join(projectDir, 'hintergruende'))
    await writeFile(join(projectDir, 'hintergruende', 'wiese.jpg'), meadow())
    await expect(
      paintBackground({ projectDir, file: 'studio/hintergruende/wiese.jpg', style: 'oil' }),
    ).rejects.toThrow('FAL_AI')
  })

  it('picks the nearest aspect ratio fal offers', () => {
    expect(nearestAspect(1080, 1920)).toBe('9:16')
    expect(nearestAspect(1000, 1000)).toBe('1:1')
    expect(nearestAspect(3200, 2513)).toBe('4:3')
  })
})

const decode = async (file: string) => PNG.sync.read(await readFile(file))
const pixel = (png: PNG, x: number, y: number) => [
  ...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3),
]

describe('rendering a background image with a finish', () => {
  async function renderWith(background: Background) {
    const { repo, projectDir, host } = await studio()
    await mkdir(join(projectDir, 'hintergruende'))
    await writeFile(join(projectDir, 'hintergruende', 'wiese.jpg'), meadow())
    await writeFile(
      join(projectDir, 'hintergruende', CREDITS_FILE),
      JSON.stringify({ 'wiese.jpg': { source: 'unsplash', attribution: 'Photo by Jo Doe on Unsplash' } }),
    )
    await runTool(host, 'update_settings', { set: 'probe', settings: { background, layout: 'text-top' } })
    const files = await renderCommand({ projectDir, setId: 'probe', requireApproval: false })
    return { repo, projectDir, png: await decode(files[0]) }
  }

  it('draws the image, finishes only the background and leaves the device untouched', async () => {
    const image = { src: 'studio/hintergruende/wiese.jpg' }
    const plain = await renderWith({ kind: 'solid', color: '#4a7a3a', image })
    const grain = await renderWith({
      kind: 'solid',
      color: '#4a7a3a',
      image,
      finish: [{ kind: 'grain', amount: 0.3 }],
    })
    const { width: w, height: h } = plain.png
    expect(pixel(plain.png, 4, 4)).toEqual([0x88, 0xbb, 0xee])
    expect(pixel(plain.png, 4, h - 4)).toEqual([0x4a, 0x7a, 0x3a])
    let differs = 0
    for (let x = 0; x < w; x += 7)
      if (pixel(plain.png, x, 10).join() !== pixel(grain.png, x, 10).join()) differs++
    expect(differs).toBeGreaterThan(10)
    for (let y = Math.round(h * 0.5); y < h * 0.8; y += 13)
      expect(pixel(grain.png, w / 2, y)).toEqual([255, 0, 0])
  })

  it('a studio set writes the credits of its backgrounds next to the pictures', async () => {
    const { repo } = await renderWith({
      kind: 'solid',
      color: '#4a7a3a',
      image: { src: 'studio/hintergruende/wiese.jpg' },
    })
    expect(JSON.parse(await readFile(join(repo, 'img', CREDITS_FILE), 'utf8'))).toEqual({
      'studio/hintergruende/wiese.jpg': { source: 'unsplash', attribution: 'Photo by Jo Doe on Unsplash' },
    })
  })

  it('a missing image file stops the render and the check names it', async () => {
    const { projectDir, host } = await studio()
    await runTool(host, 'update_settings', {
      set: 'probe',
      settings: {
        background: { kind: 'solid', color: '#222', image: { src: 'studio/hintergruende/gone.jpg' } },
      },
    })
    const { issues } = await checkCommand({ projectDir, setId: 'probe', requireApproval: false })
    expect(issues.map((i) => i.message)).toContain('Background image missing: studio/hintergruende/gone.jpg')
    await expect(renderCommand({ projectDir, setId: 'probe', requireApproval: false })).rejects.toThrow(
      'Background image missing',
    )
  })
})

describe('approval with a background image', () => {
  it('goes stale when the image file changes', async () => {
    const { projectDir, host } = await studio()
    const set = JSON.parse(await readFile(join(projectDir, 'probe.json'), 'utf8'))
    delete set.purpose
    set.locales = [{ id: 'en', store: { web: 'en-US' } }]
    set.targets[0].sizeId = 'iphone-6-9'
    set.targets[0].deviceId = 'iphone-17-pro'
    await writeFile(join(projectDir, 'probe.json'), JSON.stringify(set))
    await mkdir(join(projectDir, 'hintergruende'))
    await writeFile(join(projectDir, 'hintergruende', 'wiese.jpg'), meadow())
    await runTool(host, 'update_settings', {
      set: 'probe',
      settings: {
        background: { kind: 'solid', color: '#ffffff', image: { src: 'studio/hintergruende/wiese.jpg' } },
      },
    })
    await runTool(host, 'set_copy', { set: 'probe', locale: 'en', slot: 'a', headline: 'Calm' })
    await approveCommand({ projectDir, setId: 'probe', by: 'test' })
    expect((await checkCommand({ projectDir, setId: 'probe', requireApproval: true })).approvalOk).toBe(true)
    await writeFile(
      join(projectDir, 'hintergruende', 'wiese.jpg'),
      pngBytes(300, 400, (ctx) => {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, 300, 400)
      }),
    )
    expect((await checkCommand({ projectDir, setId: 'probe', requireApproval: true })).approvalOk).toBe(false)
  })
})

describe('a scaled context, as the GUI preview draws', () => {
  it('builds the layer at device pixels and lands it where the tile is', async () => {
    const { renderScene } = await import('../src/render/scene')
    const { loadImage } = await import('@napi-rs/canvas')
    const { DEFAULT_SETTINGS } = await import('../src/store')
    const img = await loadImage(Buffer.from(meadow()))
    const canvas = createCanvas(200, 250)
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
    ctx.setTransform(2, 0, 0, 2, 0, 0)
    const background: Background = {
      kind: 'solid',
      color: '#000000',
      image: { src: 'w.jpg' },
      finish: [{ kind: 'duotone' }],
    }
    renderScene(
      ctx,
      100,
      125,
      { id: 'a', headline: '', subhead: '', imageId: null, overrides: {} },
      { ...DEFAULT_SETTINGS, sizeId: 'studio-4x5', deviceId: 'pixel-9-pro', layout: 'text-only', background },
      { backgrounds: { 'w.jpg': img as unknown as CanvasImageSource } },
    )
    const d = ctx.getImageData(0, 0, 200, 250).data
    const at = (x: number, y: number) => [...d.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)]
    expect(at(2, 2)).not.toEqual([0, 0, 0])
    expect(at(198, 248)).not.toEqual([0, 0, 0])
    expect(at(2, 2)).not.toEqual(at(2, 248))
  })
})
