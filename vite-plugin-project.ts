import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, normalize, sep } from 'node:path'
import type { Plugin } from 'vite'
import { readProject, repoRootOf, writeProject } from './cli/project-io'
import { sourcePath } from './src/project/bridge'
import type { Project } from './src/project/types'

/** One PUT rewrites the set file and every copy file; the window covers the copies too. */
const OWN_WRITE_QUIET_MS = 500

export function projectPlugin({ projectDir, setId }: { projectDir: string; setId: string }): Plugin {
  const repoRoot = repoRootOf(projectDir)
  let lastWritten = ''
  let lastWriteAt = 0

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
      lastWritten = `${JSON.stringify(project.set, null, 2)}\n`
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
      const watcher = watch(projectDir, { recursive: true }, () => {
        if (Date.now() - lastWriteAt < OWN_WRITE_QUIET_MS) return
        // Our own PUT also fires the watcher; the GUI already holds that state.
        readFile(join(projectDir, `${setId}.json`), 'utf8')
          .then((text) => {
            if (text !== lastWritten) server.ws.send({ type: 'custom', event: 'project:changed' })
          })
          .catch(() => undefined)
      })
      server.httpServer?.once('close', () => watcher.close())

      // A rejected handler would be an unhandled rejection and take the dev server down with it;
      // a broken project file must stay a 500.
      server.middlewares.use((req, res, next) => {
        serve(req, res).then((handled) => (handled ? undefined : next()), next)
      })
    },
  }
}
