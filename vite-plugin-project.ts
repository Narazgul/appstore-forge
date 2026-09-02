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

export function projectPlugin({ projectDir, setId }: { projectDir: string; setId: string }): Plugin {
  const repoRoot = repoRootOf(projectDir)
  let lastWritten = ''
  let lastWriteAt = 0

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

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? ''
    if (url === '/api/project' && req.method === 'GET') {
      const project = await readProject(projectDir, setId)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(project))
      return true
    }
    if (url === '/api/project' && req.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const project = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Project
      await writeProject(projectDir, project)
      lastWritten = await projectDigest()
      lastWriteAt = Date.now()
      res.statusCode = 204
      res.end()
      return true
    }
    if (url.startsWith('/sources/')) {
      const [, , locale, file] = url.split('/')
      const screen = decodeURIComponent(file ?? '').replace(/\.png$/, '')
      const project = await readProject(projectDir, setId)
      const path = normalize(
        join(repoRoot, sourcePath(project.set, decodeURIComponent(locale ?? ''), screen)),
      )
      // A sibling of the repo root shares its prefix, so the separator has to be part of the test.
      if (!path.startsWith(`${repoRoot}${sep}`)) {
        res.statusCode = 403
        res.end()
        return true
      }
      try {
        res.setHeader('content-type', 'image/png')
        res.end(await readFile(path))
      } catch {
        res.statusCode = 404
        res.end()
      }
      return true
    }
    return false
  }

  return {
    name: 'forge-project',
    config: () => ({ define: { __FORGE_PROJECT__: 'true' } }),
    configureServer(server) {
      let settle: ReturnType<typeof setTimeout> | null = null
      const watcher = watch(projectDir, { recursive: true }, () => {
        if (settle) clearTimeout(settle)
        settle = setTimeout(() => {
          // Our own PUT also fires the watcher; the GUI already holds that state.
          if (Date.now() - lastWriteAt < OWN_WRITE_QUIET_MS) return
          projectDigest()
            .then((digest) => {
              if (digest !== lastWritten) server.ws.send({ type: 'custom', event: 'project:changed' })
            })
            .catch(() => undefined)
        }, WATCH_DEBOUNCE_MS)
      })
      server.httpServer?.once('close', () => {
        if (settle) clearTimeout(settle)
        watcher.close()
      })

      // A rejected handler would be an unhandled rejection and take the dev server down with it;
      // a broken project file must stay a 500.
      server.middlewares.use((req, res, next) => {
        serve(req, res).then((handled) => (handled ? undefined : next()), next)
      })
    },
  }
}
