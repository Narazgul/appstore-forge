import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { projectPlugin } from '../vite-plugin-project'

export type DevOptions = { projectDir: string; setId: string; port: number }

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const { version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

/** Installed as a dependency, the editor's imports resolve outside the package — in the
 *  consumer's node_modules, and with pnpm through its store. The outermost node_modules
 *  marks the consumer's project root, which holds all of it. */
function servableRoots(): string[] {
  const at = PACKAGE_ROOT.indexOf(`${sep}node_modules${sep}`)
  return at < 0 ? [PACKAGE_ROOT] : [PACKAGE_ROOT, PACKAGE_ROOT.slice(0, at)]
}

export async function devCommand({ projectDir, setId, port }: DevOptions): Promise<void> {
  const server = await createServer({
    configFile: false,
    root: PACKAGE_ROOT,
    base: './',
    // vite.config.ts is skipped, so the defines the app expects are repeated here.
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), tailwindcss(), projectPlugin({ projectDir, setId })],
    server: { port, open: true, fs: { allow: servableRoots() } },
  })
  await server.listen()
  server.printUrls()
  await new Promise<void>((resolve) => server.httpServer?.once('close', resolve))
}
