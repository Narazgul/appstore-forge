import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { DEFAULT_ARTWORK_SOURCES, sourceListing } from '../src/project/bridge'
import type { Gallery } from '../src/project/store'
import type { LocaleCopy, Project, ProjectSet } from '../src/project/types'

export const repoRootOf = (projectDir: string) => dirname(projectDir)
export const copyDir = (projectDir: string, setId: string) =>
  setId === 'default' ? join(projectDir, 'copy') : join(projectDir, 'copy', setId)

async function readJson<T>(path: string, fallback: T | null = null): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    if (fallback !== null && (err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

export async function readProject(projectDir: string, setId = 'default'): Promise<Project> {
  const set = await readJson<ProjectSet>(join(projectDir, `${setId}.json`))
  const copies: Project['copies'] = {}
  for (const locale of set.locales) {
    copies[locale.id] = await readJson<LocaleCopy>(join(copyDir(projectDir, setId), `${locale.id}.json`), {})
  }
  return { set, copies }
}

export async function writeProject(projectDir: string, project: Project): Promise<void> {
  const dir = copyDir(projectDir, project.set.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(projectDir, `${project.set.id}.json`), pretty(project.set))
  for (const [localeId, copy] of Object.entries(project.copies)) {
    await writeFile(join(dir, `${localeId}.json`), pretty(copy))
  }
}

/** Every image the repo holds per locale, so the GUI and `forge tool list_images` can offer a
 *  choice per frame. A template pointing outside the repo lists nothing. */
export async function readGallery(repoRoot: string, set: ProjectSet): Promise<Record<string, Gallery>> {
  const listNames = async (template: string, localeId: string, token: string) => {
    const listing = sourceListing(template, localeId, token)
    if (!listing) return []
    const dir = normalize(join(repoRoot, listing.dir))
    if (!dir.startsWith(`${repoRoot}${sep}`)) return []
    const files = await readdir(dir).catch(() => [] as string[])
    return files
      .map((file) => listing.match(file))
      .filter((name): name is string => name !== null)
      .sort()
  }
  const galleries: Record<string, Gallery> = {}
  for (const locale of set.locales) {
    galleries[locale.id] = {
      screens: await listNames(set.sources, locale.id, '{screen}'),
      artwork: await listNames(set.artworkSources ?? DEFAULT_ARTWORK_SOURCES, locale.id, '{artwork}'),
    }
  }
  return galleries
}

/** The ids of every valid set file directly under the project dir: `version: 1` and an `id`
 *  matching the file name — anything else (a stray JSON file, a half-written set) is skipped. */
export async function listSets(projectDir: string): Promise<string[]> {
  const files = await readdir(projectDir).catch(() => [] as string[])
  const ids: string[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const id = file.slice(0, -'.json'.length)
    try {
      const data = JSON.parse(await readFile(join(projectDir, file), 'utf8')) as Partial<ProjectSet>
      if (data.version === 1 && data.id === id) ids.push(id)
    } catch {
      // Not a set file (or not valid JSON) — not this listing's business.
    }
  }
  return ids.sort()
}
