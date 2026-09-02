import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
