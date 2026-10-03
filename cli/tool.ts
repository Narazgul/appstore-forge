import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { screensFor, settingsFor } from '../src/project/bridge'
import type { PreviewFile, ToolHost } from '../src/project/tools'
import { sceneSpan } from '../src/render/scene'
import { checkCommand, renderCommand } from './commands'
import { listSets, readGallery, readProject, repoRootOf, writeProject } from './project-io'
import { renderProject } from './render'
import { runCapture } from './capture'

export const GUIDELINES_FILE = 'guidelines.md'

/** Where `preview` writes: outside the repo, one folder per project and set, emptied each time. */
export const previewDir = (projectDir: string, setId: string) =>
  join(tmpdir(), 'forge-preview', `${basename(repoRootOf(projectDir))}-${basename(projectDir)}`, setId)

/** The tools' host for a project on disk — the same files `forge check`, `forge render` and the
 *  GUI (`forge dev`, which picks every write up through its file watcher) work on. */
export function fileHost(projectDir: string): ToolHost {
  const repoRoot = repoRootOf(projectDir)
  const guidelines = join(projectDir, GUIDELINES_FILE)
  return {
    listSets: () => listSets(projectDir),
    load: (setId) => readProject(projectDir, setId),
    save: (project) => writeProject(projectDir, project),
    async create(project) {
      if (existsSync(join(projectDir, `${project.set.id}.json`)))
        throw new Error(`Set ${project.set.id} exists already`)
      await writeProject(projectDir, project)
    },
    async check(setId) {
      return (await checkCommand({ projectDir, setId, requireApproval: false })).issues
    },
    async gallery(set) {
      return readGallery(repoRoot, set)
    },
    async preview(setId, { slots, locales, targets }) {
      const project = await readProject(projectDir, setId)
      const root = previewDir(projectDir, setId)
      await rm(root, { recursive: true, force: true })
      const wantedTargets = project.set.targets.filter((t) => !targets || targets.includes(t.id))
      for (const t of wantedTargets) t.out = relative(repoRoot, join(root, t.id, '{storeLocale}', '{n}.png'))
      project.set.targets = wantedTargets
      // Every slot renders, so a duo still borrows its real neighbour; only the asked-for ones are kept.
      const written = await renderProject({ project, repoRoot, localeIds: locales })
      const files: PreviewFile[] = []
      for (const target of wantedTargets) {
        const settings = settingsFor(project, target.id)
        for (const locale of project.set.locales.filter((l) => !locales || locales.includes(l.id))) {
          const folder = join(root, target.id, locale.store?.[target.id] ?? locale.id)
          let n = 0
          for (const screen of screensFor(project, locale.id)) {
            const span = sceneSpan(screen, settings)
            for (let part = 1; part <= span; part++) {
              const from = join(folder, `${++n}.png`)
              if (!written.includes(from)) continue
              if (slots && !slots.includes(screen.id)) {
                await rm(from)
                continue
              }
              const file = join(folder, span > 1 ? `${screen.id}-${part}.png` : `${screen.id}.png`)
              await rename(from, file)
              files.push({ slot: screen.id, locale: locale.id, target: target.id, part, file })
            }
          }
        }
      }
      return files
    },
    render: (setId, { locales, targets, requireApproval }) =>
      renderCommand({ projectDir, setId, localeIds: locales, targetIds: targets, requireApproval }),
    capture: (opts) => runCapture(projectDir, opts),
    async readGuidelines() {
      return existsSync(guidelines) ? readFile(guidelines, 'utf8') : null
    },
    async writeGuidelines(text) {
      await mkdir(projectDir, { recursive: true })
      await writeFile(guidelines, text)
    },
    today: () => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    },
  }
}
