import { watch } from 'node:fs'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, normalize, sep } from 'node:path'
import type { Plugin } from 'vite'
import { copyDir, listSets, readGallery, readProject, repoRootOf, writeProject } from './cli/project-io'
import { SET_ID_RE } from './src/project/duplicate'
import { artworkPath, sourcePath } from './src/project/bridge'
import type { Project } from './src/project/types'

/** One PUT rewrites the set file and every copy file; the window covers the copies too. */
const OWN_WRITE_QUIET_MS = 500
/** fs.watch reports one save as several events; wait for the burst to end. */
const WATCH_DEBOUNCE_MS = 150
const MAX_BODY_BYTES = 5 * 1024 * 1024

/** `writeProject` turns the set id and the locale keys into file names, so a body from the
 *  page decides where the server writes. Only names that stay inside the project pass. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

/** The path a URL addresses, ignoring its query string. */
const pathnameOf = (url: string) => url.split('?')[0]

const isProjectRoute = (url: string) => {
  const path = pathnameOf(url)
  return (
    path === '/api/project' ||
    path === '/api/gallery' ||
    path === '/api/sets' ||
    path.startsWith('/sources/') ||
    path.startsWith('/artwork/')
  )
}

/** The `?set=` value of a URL, or null when absent. */
export function parseSetParam(url: string): string | null {
  const query = url.split('?')[1]
  if (!query) return null
  return new URLSearchParams(query).get('set')
}

/** `?set=` addresses a specific set; without it, the set `forge dev --set` was started with.
 *  A value that could escape the project directory falls back to that default instead of erroring —
 *  the request then simply finds no such set, exactly like an unknown id would. */
export function resolveSetId(url: string, fallback: string): string {
  const requested = parseSetParam(url)
  return requested && SAFE_ID.test(requested) ? requested : fallback
}

export function validateNewProjectBody(body: unknown): string | null {
  const project = body as Project | null
  if (!project || typeof project !== 'object') return 'Body must be a project object'
  const id = project.set?.id
  if (typeof id !== 'string' || !SET_ID_RE.test(id)) return `Invalid set id "${String(id)}"`
  if (!project.copies || typeof project.copies !== 'object') return 'Project copies must be an object'
  const bad = Object.keys(project.copies).find((localeId) => !SAFE_ID.test(localeId))
  return bad === undefined ? null : `Invalid locale id "${bad}"`
}

/**
 * The path the browser asked for. Registered after Vite's own middlewares, this handler sees
 * `req.url` already rewritten to `/index.html` by the SPA fallback; connect keeps the request's
 * own path in `originalUrl`.
 */
export function projectRoute(req: { url?: string; originalUrl?: string }): string {
  const url = req.url ?? ''
  if (isProjectRoute(url)) return url
  const original = req.originalUrl ?? ''
  return isProjectRoute(original) ? original : url
}

export function validatePutBody(body: unknown, setId: string): string | null {
  const project = body as Project | null
  if (!project || typeof project !== 'object') return 'Body must be a project object'
  if (project.set?.id !== setId) return `Project set id must be "${setId}"`
  if (!project.copies || typeof project.copies !== 'object') return 'Project copies must be an object'
  const bad = Object.keys(project.copies).find((localeId) => !SAFE_ID.test(localeId))
  return bad === undefined ? null : `Invalid locale id "${bad}"`
}

/**
 * The request handling, split out from `projectPlugin` so it can be driven with plain fake
 * `req`/`res` objects in a test — no real HTTP server or Vite dev server required.
 */
export function createProjectHandlers({ projectDir, setId }: { projectDir: string; setId: string }) {
  const repoRoot = repoRootOf(projectDir)
  let lastWritten = ''
  let lastWriteAt = 0
  let writing = 0
  // The set a client last opened or saved, via `?set=`; the watcher and the image routes follow
  // it instead of only ever the id `forge dev --set` was started with.
  let currentSetId = setId

  /** The copy files count too: an agent editing only `copy/de.json` must reach the GUI. */
  async function projectDigest(id: string): Promise<string> {
    const dir = copyDir(projectDir, id)
    const names = await readdir(dir).catch(() => [] as string[])
    const files = [join(projectDir, `${id}.json`), ...names.sort().map((name) => join(dir, name))]
    const hash = createHash('sha256')
    for (const file of files) {
      const text = await readFile(file, 'utf8').catch(() => '')
      hash.update(`${file}\n${text}\n`)
    }
    return hash.digest('hex')
  }

  const listSetIds = () => listSets(projectDir)

  async function readBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | null> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY_BYTES) {
        res.statusCode = 413
        res.end('Project too large')
        req.destroy()
        return null
      }
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }

  async function putProject(req: IncomingMessage, res: ServerResponse, targetSetId: string): Promise<void> {
    const body = await readBody(req, res)
    if (!body) return
    let parsed: unknown
    try {
      parsed = JSON.parse(body.toString('utf8'))
    } catch {
      res.statusCode = 400
      res.end('Body is not valid JSON')
      return
    }
    const problem = validatePutBody(parsed, targetSetId)
    if (problem) {
      res.statusCode = 400
      res.end(problem)
      return
    }
    // The window has to cover the write itself, not just what follows it.
    writing++
    lastWriteAt = Date.now()
    try {
      await writeProject(projectDir, parsed as Project)
      currentSetId = targetSetId
      lastWritten = await projectDigest(targetSetId)
      lastWriteAt = Date.now()
    } finally {
      writing--
    }
    res.statusCode = 204
    res.end()
  }

  async function postSet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req, res)
    if (!body) return
    let parsed: unknown
    try {
      parsed = JSON.parse(body.toString('utf8'))
    } catch {
      res.statusCode = 400
      res.end('Body is not valid JSON')
      return
    }
    const problem = validateNewProjectBody(parsed)
    if (problem) {
      res.statusCode = 400
      res.end(problem)
      return
    }
    const project = parsed as Project
    const id = project.set.id
    const exists = await stat(join(projectDir, `${id}.json`)).then(
      () => true,
      () => false,
    )
    if (exists) {
      res.statusCode = 409
      res.end(`Set "${id}" already exists`)
      return
    }
    writing++
    try {
      await writeProject(projectDir, project)
      currentSetId = id
      lastWriteAt = Date.now()
      lastWritten = await projectDigest(id)
    } finally {
      writing--
    }
    res.statusCode = 201
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id }))
  }

  async function sendImage(
    url: string,
    res: ServerResponse,
    resolve: (set: Project['set'], locale: string, name: string) => string,
  ): Promise<void> {
    const [, , locale, file] = url.split('/')
    let path: string
    try {
      const name = decodeURIComponent(file ?? '').replace(/\.png$/, '')
      const project = await readProject(projectDir, currentSetId)
      path = normalize(join(repoRoot, resolve(project.set, decodeURIComponent(locale ?? ''), name)))
    } catch (err) {
      if (!(err instanceof URIError)) throw err
      res.statusCode = 400
      res.end('Malformed source path')
      return
    }
    // A sibling of the repo root shares its prefix, so the separator has to be part of the test.
    if (!path.startsWith(`${repoRoot}${sep}`)) {
      res.statusCode = 403
      res.end()
      return
    }
    try {
      res.setHeader('content-type', 'image/png')
      res.end(await readFile(path))
    } catch {
      res.statusCode = 404
      res.end()
    }
  }

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = projectRoute(req)
    const path = pathnameOf(url)
    if (path === '/api/project' && req.method === 'GET') {
      const requested = resolveSetId(url, setId)
      currentSetId = requested
      const project = await readProject(projectDir, requested)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(project))
      return true
    }
    if (path === '/api/gallery' && req.method === 'GET') {
      const project = await readProject(projectDir, resolveSetId(url, currentSetId))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(await readGallery(repoRoot, project.set)))
      return true
    }
    if (path === '/api/project' && req.method === 'PUT') {
      await putProject(req, res, resolveSetId(url, setId))
      return true
    }
    if (path === '/api/sets' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(await listSetIds()))
      return true
    }
    if (path === '/api/sets' && req.method === 'POST') {
      await postSet(req, res)
      return true
    }
    if (path.startsWith('/sources/')) {
      await sendImage(path, res, sourcePath)
      return true
    }
    if (path.startsWith('/artwork/')) {
      await sendImage(path, res, artworkPath)
      return true
    }
    return false
  }

  /**
   * True when the watcher's own recent write (PUT or POST) could still explain the file system
   * event it is reacting to — comparing a digest during that window would read a half-written
   * project against the previous one and announce a change the GUI already holds.
   */
  const inOwnWriteWindow = () => writing > 0 || Date.now() - lastWriteAt < OWN_WRITE_QUIET_MS

  /**
   * The watcher's one call: digests whichever set is currently open and reports whether it moved
   * since the last time anyone asked (a write through this handler, or a previous outside change),
   * updating the baseline either way.
   */
  async function checkForOutsideChange(): Promise<boolean> {
    const digest = await projectDigest(currentSetId)
    const changed = digest !== lastWritten
    lastWritten = digest
    return changed
  }

  return { serve, getCurrentSetId: () => currentSetId, inOwnWriteWindow, checkForOutsideChange }
}

export function projectPlugin({ projectDir, setId }: { projectDir: string; setId: string }): Plugin {
  const handlers = createProjectHandlers({ projectDir, setId })

  return {
    name: 'forge-project',
    config: () => ({ define: { __FORGE_PROJECT__: 'true' } }),
    configureServer(server) {
      let settle: ReturnType<typeof setTimeout> | null = null
      const onFileEvent = () => {
        if (settle) clearTimeout(settle)
        settle = setTimeout(() => {
          settle = null
          if (handlers.inOwnWriteWindow()) return onFileEvent()
          handlers
            .checkForOutsideChange()
            .then((changed) => {
              if (changed) server.ws.send({ type: 'custom', event: 'project:changed' })
            })
            .catch(() => undefined)
        }, WATCH_DEBOUNCE_MS)
      }
      const watcher = watch(projectDir, { recursive: true }, onFileEvent)
      server.httpServer?.once('close', () => {
        if (settle) clearTimeout(settle)
        watcher.close()
      })

      // Registering after Vite's own middlewares puts the host check and cors in front of the
      // project files. A rejected handler would be an unhandled rejection and take the dev
      // server down with it; a broken project file must stay a 500.
      return () => {
        server.middlewares.use((req, res, next) => {
          handlers.serve(req, res).then((handled) => (handled ? undefined : next()), next)
        })
      }
    },
  }
}
