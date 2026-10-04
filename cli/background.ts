import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import {
  PAINT_MODEL,
  PAINT_PRICE_USD,
  PAINT_STYLES,
  paintPrompt,
  type PaintStyle,
} from '../src/presets/paintStyles'
import type { BackgroundChoice } from '../src/project/store'
import { CliError } from './errors'
import { repoRootOf } from './project-io'

export const CREDITS_FILE = 'credits.json'
export const BACKGROUND_DIR = 'hintergruende'

export type BackgroundSource = 'unsplash' | 'met' | 'aic'
export const BACKGROUND_SOURCES: BackgroundSource[] = ['unsplash', 'met', 'aic']

/** Where a background file came from and how it has to be credited. `attribution` is the line a
 *  page using the picture shows; a painted file carries its source's credit in `basedOn`. */
export type Credit = {
  source: BackgroundSource | 'fal'
  id?: string
  title?: string
  author?: string
  authorUrl?: string
  date?: string
  url?: string
  license?: string
  attribution?: string
  fetched?: string
  average?: string
  from?: string
  basedOn?: Credit
  model?: string
  style?: string
  prompt?: string
  seed?: number
  priceUsd?: number
}

export type Candidate = { id: string; title: string; author: string; imageUrl: string; credit: Credit }

type Fetch = typeof fetch

const today = () => new Date().toISOString().slice(0, 10)

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

export function readCreditsFile(dir: string): Record<string, Credit> {
  const path = join(dir, CREDITS_FILE)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, Credit>
  } catch {
    return {}
  }
}

/** The credits of the given background files (paths from the repo root), keyed by that path;
 *  a file nobody fetched or painted (a photo of one's own) has none. */
export function creditsFor(repoRoot: string, srcs: string[]): Record<string, Credit> {
  const out: Record<string, Credit> = {}
  for (const src of srcs) {
    const credit = readCreditsFile(dirname(join(repoRoot, src)))[basename(src)]
    if (credit) out[src] = credit
  }
  return out
}

export const BACKGROUND_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

/** Every image in the project's background folder, by its path from the repo root, with the mean
 *  colour its credits record. */
export async function listBackgroundChoices(projectDir: string): Promise<BackgroundChoice[]> {
  const dir = join(projectDir, BACKGROUND_DIR)
  const files = await readdir(dir).catch(() => [] as string[])
  const credits = readCreditsFile(dir)
  const root = repoRootOf(projectDir)
  return files
    .filter((file) => BACKGROUND_EXTENSIONS.includes(extname(file).toLowerCase()))
    .sort()
    .map((file) => {
      const src = relative(root, join(dir, file)).split(sep).join('/')
      const average = credits[file]?.average
      return average ? { src, average } : { src }
    })
}

export async function writeOutputCredits(dir: string, credits: Record<string, Credit>) {
  if (!Object.keys(credits).length) return
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, CREDITS_FILE), pretty(credits))
}

async function addCredit(dir: string, file: string, credit: Credit) {
  const all = readCreditsFile(dir)
  all[file] = credit
  await writeFile(join(dir, CREDITS_FILE), pretty(all))
}

async function getJson(fetchImpl: Fetch, url: string, headers: Record<string, string> = {}) {
  const res = await fetchImpl(url, { headers })
  if (!res.ok)
    throw new CliError(`${new URL(url).host} answered ${res.status} for ${new URL(url).pathname}`, 1)
  return res.json()
}

async function getBytes(fetchImpl: Fetch, url: string, headers: Record<string, string> = {}) {
  const res = await fetchImpl(url, { headers })
  if (!res.ok) throw new CliError(`Download failed (${res.status}): ${url}`, 1)
  return new Uint8Array(await res.arrayBuffer())
}

const UTM = (app: string) => `utm_source=${encodeURIComponent(app)}&utm_medium=referral`
const withUtm = (url: string, app: string) => `${url}${url.includes('?') ? '&' : '?'}${UTM(app)}`

type UnsplashPhoto = {
  id: string
  description: string | null
  alt_description: string | null
  urls: { raw: string }
  links: { html: string; download_location: string }
  user: { name: string; links: { html: string } }
}

export type FetchOptions = {
  source: BackgroundSource
  query: string
  orientation?: 'portrait' | 'landscape' | 'squarish'
  count?: number
  unsplashKey?: string
  unsplashApp?: string
  fetchImpl?: Fetch
}

const AIC_HEADERS = { 'AIC-User-Agent': 'appstore-forge (https://github.com/Narazgul/appstore-forge)' }

/**
 * The first `count` candidates for a query, already narrowed to what may be used: Unsplash photos
 * (Unsplash License), and from the Met and the Art Institute of Chicago only public-domain works
 * (CC0) that have an image. `id:<id>` asks for exactly that photo or object.
 */
export async function searchBackgrounds(opts: FetchOptions): Promise<Candidate[]> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const count = opts.count ?? 10
  const byId = opts.query.startsWith('id:') ? opts.query.slice(3) : null
  if (opts.source === 'unsplash') {
    if (!opts.unsplashKey) throw new CliError('UNSPLASH_ACCESS_KEY is not set', 1)
    const app = opts.unsplashApp ?? 'appstore_forge'
    const headers = { Authorization: `Client-ID ${opts.unsplashKey}`, 'Accept-Version': 'v1' }
    const params = new URLSearchParams({
      query: opts.query,
      per_page: String(Math.min(30, count)),
      content_filter: 'high',
      ...(opts.orientation ? { orientation: opts.orientation } : {}),
    })
    const photos: UnsplashPhoto[] = byId
      ? [await getJson(fetchImpl, `https://api.unsplash.com/photos/${encodeURIComponent(byId)}`, headers)]
      : (await getJson(fetchImpl, `https://api.unsplash.com/search/photos?${params}`, headers)).results
    return photos.slice(0, count).map((p) => ({
      id: p.id,
      title: p.alt_description ?? p.description ?? '',
      author: p.user.name,
      imageUrl: `${p.urls.raw}${p.urls.raw.includes('?') ? '&' : '?'}w=2160&q=80&fm=jpg`,
      credit: {
        source: 'unsplash',
        id: p.id,
        title: p.alt_description ?? p.description ?? undefined,
        author: p.user.name,
        authorUrl: withUtm(p.user.links.html, app),
        url: withUtm(p.links.html, app),
        license: 'Unsplash License (https://unsplash.com/license)',
        attribution: `Photo by ${p.user.name} on Unsplash`,
        downloadLocation: p.links.download_location,
      } as Credit & { downloadLocation: string },
    }))
  }
  if (opts.source === 'met') {
    const base = 'https://collectionapi.metmuseum.org/public/collection'
    const ids: number[] = byId
      ? [Number(byId)]
      : ((
          await getJson(
            fetchImpl,
            `${base}/v1.1/search?${new URLSearchParams({ q: opts.query, hasImages: 'true', isPublicDomain: 'true', limit: '60' })}`,
          )
        ).objectIDs ?? [])
    const found: Candidate[] = []
    for (const id of ids) {
      if (found.length >= count) break
      // The search still lists objects the object endpoint no longer serves.
      const o = await getJson(fetchImpl, `${base}/v1/objects/${id}`).catch(() => null)
      if (o?.isPublicDomain !== true || !o.primaryImage) continue
      const author = o.artistDisplayName || 'Unknown artist'
      found.push({
        id: String(o.objectID),
        title: o.title,
        author,
        imageUrl: o.primaryImage,
        credit: {
          source: 'met',
          id: String(o.objectID),
          title: o.title,
          author,
          date: o.objectDate || undefined,
          url: o.objectURL,
          license: 'CC0 (The Met Open Access)',
          attribution: `${o.title}, ${author}${o.objectDate ? `, ${o.objectDate}` : ''}. The Metropolitan Museum of Art (CC0)`,
        },
      })
    }
    return found
  }
  const fields = 'id,title,artist_title,artist_display,date_display,image_id,is_public_domain'
  const works = byId
    ? [
        (
          await getJson(
            fetchImpl,
            `https://api.artic.edu/api/v1/artworks/${byId}?fields=${fields}`,
            AIC_HEADERS,
          )
        ).data,
      ]
    : (
        await getJson(
          fetchImpl,
          `https://api.artic.edu/api/v1/artworks/search?${new URLSearchParams({ q: opts.query, 'query[term][is_public_domain]': 'true', fields, limit: String(Math.min(40, count * 2)) })}`,
          AIC_HEADERS,
        )
      ).data
  return (works as Record<string, string | boolean | number | null>[])
    .filter((w) => w.is_public_domain === true && !!w.image_id)
    .slice(0, count)
    .map((w) => {
      const author = String(w.artist_title || w.artist_display || 'Unknown artist')
      return {
        id: String(w.id),
        title: String(w.title),
        author,
        imageUrl: `https://www.artic.edu/iiif/2/${w.image_id}/full/1686,/0/default.jpg`,
        credit: {
          source: 'aic',
          id: String(w.id),
          title: String(w.title),
          author,
          date: w.date_display ? String(w.date_display) : undefined,
          url: `https://www.artic.edu/artworks/${w.id}`,
          license: 'CC0 (Art Institute of Chicago)',
          attribution: `${w.title}, ${author}${w.date_display ? `, ${w.date_display}` : ''}. Art Institute of Chicago (CC0)`,
        },
      }
    })
}

/** The mean colour of an image, as hex: what the background's own colour should be set to, so the
 *  contrast checks and the first paint match the picture. */
export async function averageColor(bytes: Uint8Array): Promise<string> {
  const img = await loadImage(Buffer.from(bytes))
  const canvas = createCanvas(16, 16)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, 16, 16)
  const d = ctx.getImageData(0, 0, 16, 16).data
  const sum = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += d[i + c]
  return `#${sum
    .map((v) =>
      Math.round(v / 256)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** Longest side a stored background keeps: enough to cover a 16:9 studio picture at full width
 *  even from a portrait original, without museum masters of 8 MB in the repo. */
export const MAX_SIDE = 3200

/** How many lines from one edge are a flat mount or shadow (low spread of brightness) rather than
 *  the picture; at most `limit`. */
function flatLines(
  lum: Float64Array,
  w: number,
  h: number,
  edge: 'top' | 'bottom' | 'left' | 'right',
  limit: number,
) {
  const vertical = edge === 'top' || edge === 'bottom'
  const lines = vertical ? h : w
  const along = vertical ? w : h
  let n = 0
  let first = -1
  for (; n < limit; n++) {
    const line = edge === 'top' || edge === 'left' ? n : lines - 1 - n
    let sum = 0
    let sq = 0
    for (let k = 0; k < along; k++) {
      const v = vertical ? lum[line * w + k] : lum[k * w + line]
      sum += v
      sq += v * v
    }
    const mean = sum / along
    if (first < 0) first = mean
    if (Math.sqrt(Math.max(0, sq / along - mean * mean)) > 10 || Math.abs(mean - first) > 12) break
  }
  return n
}

/** Museum photographs show the painting on a dark or light mount; the background wants the paint
 *  only. Trims flat edges (and a hair more, for the canvas edge), at most 10 % a side. */
export function trimBox(lum: Float64Array, w: number, h: number) {
  const inset = (n: number, size: number) =>
    n > 2 ? Math.min(n + Math.round(size * 0.006), Math.round(size * 0.1)) : 0
  const top = inset(flatLines(lum, w, h, 'top', Math.round(h * 0.1)), h)
  const bottom = inset(flatLines(lum, w, h, 'bottom', Math.round(h * 0.1)), h)
  const left = inset(flatLines(lum, w, h, 'left', Math.round(w * 0.1)), w)
  const right = inset(flatLines(lum, w, h, 'right', Math.round(w * 0.1)), w)
  return { x: left, y: top, w: w - left - right, h: h - top - bottom }
}

async function fitForRepo(bytes: Uint8Array, trim: boolean): Promise<Uint8Array> {
  const img = await loadImage(Buffer.from(bytes))
  let crop = { x: 0, y: 0, w: img.width, h: img.height }
  if (trim) {
    const probe = createCanvas(img.width, img.height)
    const pctx = probe.getContext('2d')
    pctx.drawImage(img, 0, 0)
    const d = pctx.getImageData(0, 0, img.width, img.height).data
    const lum = new Float64Array(img.width * img.height)
    for (let i = 0; i < lum.length; i++)
      lum[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114
    crop = trimBox(lum, img.width, img.height)
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(crop.w, crop.h))
  if (scale === 1 && crop.w === img.width && crop.h === img.height) return bytes
  const canvas = createCanvas(Math.round(crop.w * scale), Math.round(crop.h * scale))
  canvas.getContext('2d').drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height)
  return new Uint8Array(canvas.encodeSync('jpeg', 88))
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

export type SavedBackground = { src: string; file: string; average: string; credit: Credit }

/** Loads one candidate into the project's background folder and records its credit. For Unsplash
 *  this also reports the download, which the API requires for every photo that is used. */
export async function saveBackground(
  projectDir: string,
  candidate: Candidate,
  opts: { name?: string; dir?: string; force?: boolean; unsplashKey?: string; fetchImpl?: Fetch },
): Promise<SavedBackground> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const dir = join(projectDir, opts.dir ?? BACKGROUND_DIR)
  const file = `${slug(opts.name ?? `${candidate.credit.source}-${candidate.id}`)}.jpg`
  const path = join(dir, file)
  if (existsSync(path) && !opts.force)
    throw new CliError(`${relative(process.cwd(), path)} exists already; pass --force or --name`, 1)
  const { downloadLocation, ...credit } = candidate.credit as Credit & { downloadLocation?: string }
  const bytes = await fitForRepo(
    await getBytes(fetchImpl, candidate.imageUrl, credit.source === 'aic' ? AIC_HEADERS : {}),
    credit.source !== 'unsplash',
  )
  if (downloadLocation) {
    if (!opts.unsplashKey) throw new CliError('UNSPLASH_ACCESS_KEY is not set', 1)
    await getJson(fetchImpl, downloadLocation, { Authorization: `Client-ID ${opts.unsplashKey}` })
  }
  const average = await averageColor(bytes)
  await mkdir(dir, { recursive: true })
  await writeFile(path, bytes)
  const saved: Credit = { ...credit, fetched: today(), average }
  await addCredit(dir, file, saved)
  return { src: relative(repoRootOf(projectDir), path), file: path, average, credit: saved }
}

const ASPECTS = ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21']
export const nearestAspect = (w: number, h: number) =>
  ASPECTS.reduce((best, a) => {
    const [x, y] = a.split(':').map(Number)
    const [bx, by] = best.split(':').map(Number)
    return Math.abs(Math.log(x / y / (w / h))) < Math.abs(Math.log(bx / by / (w / h))) ? a : best
  })

export type PaintOptions = {
  projectDir: string
  file: string
  style: PaintStyle
  seed?: number
  name?: string
  force?: boolean
  dryRun?: boolean
  falKey?: string
  fetchImpl?: Fetch
}

/**
 * Repaints a background once through fal.ai (image to image) and keeps the result as a new file
 * next to the source, with model, prompt and seed in its credit. A painted photo still needs its
 * photographer's credit, so the source's own credit travels along in `basedOn`.
 */
export async function paintBackground(opts: PaintOptions) {
  const repoRoot = repoRootOf(opts.projectDir)
  const source = [opts.file, join(repoRoot, opts.file), join(opts.projectDir, opts.file)]
    .map((p) => (isAbsolute(p) ? p : resolve(p)))
    .find((p) => existsSync(p))
  if (!source) throw new CliError(`No such background: ${opts.file}`, 1)
  if (!(opts.style in PAINT_STYLES))
    throw new CliError(`Unknown style ${opts.style}; one of ${Object.keys(PAINT_STYLES).join(', ')}`, 1)
  const dir = dirname(source)
  const file = `${slug(opts.name ?? `${basename(source, extname(source))}-${opts.style}`)}.jpg`
  const target = join(dir, file)
  if (existsSync(target) && !opts.force)
    throw new CliError(`${file} exists already; pass --force or --name`, 1)
  const seed = opts.seed ?? 1
  const prompt = paintPrompt(opts.style)
  const img = await loadImage(await readFile(source))
  const scale = Math.min(1, 1536 / Math.max(img.width, img.height))
  const canvas = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale))
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  const request = {
    prompt,
    seed,
    aspect_ratio: nearestAspect(img.width, img.height),
    output_format: 'jpeg',
    safety_tolerance: '2',
  }
  if (opts.dryRun) return { dryRun: true, model: PAINT_MODEL, priceUsd: PAINT_PRICE_USD, target, request }
  if (!opts.falKey) throw new CliError('FAL_AI is not set', 1)
  const fetchImpl = opts.fetchImpl ?? fetch
  const res = await fetchImpl(`https://fal.run/${PAINT_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${opts.falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...request,
      image_url: `data:image/jpeg;base64,${canvas.encodeSync('jpeg', 90).toString('base64')}`,
    }),
  })
  if (!res.ok) throw new CliError(`fal.ai answered ${res.status}: ${(await res.text()).slice(0, 300)}`, 1)
  const result = (await res.json()) as { images?: { url: string }[]; seed?: number }
  const url = result.images?.[0]?.url
  if (!url) throw new CliError('fal.ai returned no image', 1)
  const bytes = await getBytes(fetchImpl, url)
  await writeFile(target, bytes)
  const basedOn = readCreditsFile(dir)[basename(source)]
  const credit: Credit = {
    source: 'fal',
    from: relative(repoRoot, source),
    model: PAINT_MODEL,
    style: opts.style,
    prompt,
    seed: result.seed ?? seed,
    priceUsd: PAINT_PRICE_USD,
    fetched: today(),
    average: await averageColor(bytes),
    ...(basedOn ? { basedOn, attribution: basedOn.attribution } : {}),
  }
  await addCredit(dir, file, credit)
  return { src: relative(repoRoot, target), file: target, credit }
}

const BG_USAGE = `forge bg fetch <unsplash|met|aic> <query | id:<id>> --project <dir> [--list] [--pick n] [--name file] [--orientation portrait|landscape|squarish] [--dir hintergruende] [--force]
forge bg paint <file> --style <oil|watercolor|ink|gouache> --project <dir> [--seed n] [--name file] [--force] [--dry-run]`

export async function bgCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      list: { type: 'boolean', default: false },
      pick: { type: 'string', default: '1' },
      name: { type: 'string' },
      orientation: { type: 'string' },
      dir: { type: 'string' },
      force: { type: 'boolean', default: false },
      style: { type: 'string' },
      seed: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const [action, ...args] = positionals
  if (!values.project || !action) {
    console.error(BG_USAGE)
    return 1
  }
  const projectDir = resolve(values.project)
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))
  if (action === 'fetch') {
    const [source, ...words] = args
    if (!BACKGROUND_SOURCES.includes(source as BackgroundSource) || !words.length) {
      console.error(BG_USAGE)
      return 1
    }
    const pick = Number(values.pick)
    if (!Number.isInteger(pick) || pick < 1) throw new CliError('--pick must be 1 or more', 1)
    const candidates = await searchBackgrounds({
      source: source as BackgroundSource,
      query: words.join(' '),
      orientation: values.orientation as FetchOptions['orientation'],
      count: values.list ? 10 : pick,
      unsplashKey: process.env.UNSPLASH_ACCESS_KEY,
      unsplashApp: process.env.UNSPLASH_APP_NAME,
    })
    if (values.list) {
      print(candidates.map((c, i) => ({ pick: i + 1, id: c.id, title: c.title, author: c.author })))
      return 0
    }
    const candidate = candidates[pick - 1]
    if (!candidate) throw new CliError(`No usable result ${pick} for "${words.join(' ')}"`, 2)
    print(
      await saveBackground(projectDir, candidate, {
        name: values.name,
        dir: values.dir,
        force: values.force,
        unsplashKey: process.env.UNSPLASH_ACCESS_KEY,
      }),
    )
    return 0
  }
  if (action === 'paint') {
    if (!args[0] || !values.style) {
      console.error(BG_USAGE)
      return 1
    }
    const seed = values.seed === undefined ? undefined : Number(values.seed)
    if (seed !== undefined && !Number.isInteger(seed)) throw new CliError('--seed must be an integer', 1)
    print(
      await paintBackground({
        projectDir,
        file: args[0],
        style: values.style as PaintStyle,
        seed,
        name: values.name,
        force: values.force,
        dryRun: values['dry-run'],
        falKey: process.env.FAL_AI,
      }),
    )
    return 0
  }
  console.error(BG_USAGE)
  return 1
}
