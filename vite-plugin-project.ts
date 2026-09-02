import { watch } from 'node:fs'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, normalize, sep } from 'node:path'
import type { Plugin } from 'vite'
import { copyDir, readProject, repoRootOf, writeProject } from './cli/project-io'
import { sourcePath } from './src/project/bridge'
import type { Project } from './src/project/types'

/** One PUT rewrites the set file and every copy file; the window covers the copies too. */
const OWN_WRITE_QUIET_MS = 500
/** fs.watch reports one save as several events; wait for the burst to end. */
const WATCH_DEBOUNCE_MS = 150
const MAX_BODY_BYTES = 5 * 1024 * 1024

/** `writeProject` turns the set id and the locale keys into file names, so a body from the
 *  page decides where the server writes. Only names that stay inside the project pass. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

const isProjectRoute = (url: string) => url === '/api/project' || url.startsWith('/sources/')

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

export function projectPlugin({ projectDir, setId }: { projectDir: string; setId: string }): Plugin {
  const repoRoot = repoRootOf(projectDir)
  let lastWritten = ''
  let lastWriteAt = 0
  let writing = 0

  /** The copy files count too: an agent editing only `copy/de.json` must reach the GUI. */
  async function projectDigest(): Promise<string> {
    const dir = copyDir(projectDir, setId)
    const names = await readdir(dir).catch(() => [] as string[])
    const files = [join(projectDir, `${setId}.json`), ...names.sort().map((name) => join(dir, name))]
    const hash = createHash('sha256')
    for (const file of files) {
      const text = await readFile(file, 'utf8').catch(() => '')
      hash.update(`${file}\n${text}\n`)
    }
    return hash.digest('hex')
  }

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

  async function putProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const problem = validatePutBody(parsed, setId)
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
      lastWritten = await projectDigest()
      lastWriteAt = Date.now()
    } finally {
      writing--
    }
    res.statusCode = 204
    res.end()
  }

  async function sendSource(url: string, res: ServerResponse): Promise<void> {
    const [, , locale, file] = url.split('/')
    let path: string
    try {
      const screen = decodeURIComponent(file ?? '').replace(/\.png$/, '')
      const project = await readProject(projectDir, setId)
      path = normalize(join(repoRoot, sourcePath(project.set, decodeURIComponent(locale ?? ''), screen)))
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
    if (url === '/api/project' && req.method === 'GET') {
      const project = await readProject(projectDir, setId)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(project))
      return true
    }
    if (url === '/api/project' && req.method === 'PUT') {
      await putProject(req, res)
      return true
    }
    if (url.startsWith('/sources/')) {
      await sendSource(url, res)
      return true
    }
    return false
  }

  return {
    name: 'forge-project',
    config: () => ({ define: { __FORGE_PROJECT__: 'true' } }),
    configureServer(server) {
      let settle: ReturnType<typeof setTimeout> | null = null
      const onFileEvent = () => {
        if (settle) clearTimeout(settle)
        settle = setTimeout(() => {
          settle = null
          // Comparing while our own write is still running would read a half-written project
          // against the previous digest and announce a change the GUI already holds.
          if (writing > 0) return onFileEvent()
          if (Date.now() - lastWriteAt < OWN_WRITE_QUIET_MS) return
          projectDigest()
            .then((digest) => {
              if (digest !== lastWritten) server.ws.send({ type: 'custom', event: 'project:changed' })
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
          serve(req, res).then((handled) => (handled ? undefined : next()), next)
        })
      }
    },
  }
}
