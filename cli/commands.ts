import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { artworkPath, sourcePath } from '../src/project/bridge'
import { approvalHash } from '../src/project/hash'
import type { Approval, Project } from '../src/project/types'
import { validateProject, type Issue } from '../src/project/validate'
import { CliError } from './errors'
import { readProject, repoRootOf, writeProject } from './project-io'
import { renderProject } from './render'

export function formatIssue(i: Issue): string {
  const where = [i.slot && `slot ${i.slot}`, i.locale && `locale ${i.locale}`].filter(Boolean).join(', ')
  return `${i.level}: ${i.message}${where ? ` (${where})` : ''}`
}

async function load(projectDir: string, setId: string) {
  const repoRoot = repoRootOf(projectDir)
  const project = await readProject(projectDir, setId)
  const exists = (locale: string, screen: string) =>
    existsSync(join(repoRoot, sourcePath(project.set, locale, screen)))
  const bytes = async (locale: string, screen: string) =>
    new Uint8Array(await readFile(join(repoRoot, sourcePath(project.set, locale, screen))))
  const artExists = (locale: string, artwork: string) =>
    existsSync(join(repoRoot, artworkPath(project.set, locale, artwork)))
  const artBytes = async (locale: string, artwork: string) =>
    new Uint8Array(await readFile(join(repoRoot, artworkPath(project.set, locale, artwork))))
  return { repoRoot, project, exists, bytes, artExists, artBytes }
}

function assertValid(issues: Issue[]) {
  const errors = issues.filter((i) => i.level === 'error')
  if (errors.length) throw new CliError(errors.map(formatIssue).join('\n'), 2)
}

type Bytes = (a: string, b: string) => Promise<Uint8Array>

async function approvalMatches(project: Project, bytes: Bytes, artBytes: Bytes) {
  if (!project.set.approval) return false
  return (await approvalHash(project, bytes, artBytes)) === project.set.approval.hash
}

export async function checkCommand(opts: { projectDir: string; setId: string; requireApproval: boolean }) {
  const { project, exists, bytes, artExists, artBytes } = await load(opts.projectDir, opts.setId)
  const issues = validateProject(project, exists, artExists)
  const approvalOk =
    opts.requireApproval && !issues.some((i) => i.level === 'error')
      ? await approvalMatches(project, bytes, artBytes)
      : null
  return { issues, approvalOk }
}

export async function renderCommand(opts: {
  projectDir: string
  setId: string
  targetIds?: string[]
  localeIds?: string[]
  requireApproval: boolean
}) {
  const { repoRoot, project, exists, bytes, artExists, artBytes } = await load(opts.projectDir, opts.setId)
  assertValid(validateProject(project, exists, artExists))
  if (opts.requireApproval && !(await approvalMatches(project, bytes, artBytes))) {
    throw new CliError(
      project.set.approval
        ? `Approval by ${project.set.approval.by} at ${project.set.approval.at} no longer matches: set, copy or a source image changed since. Approve again in the GUI or with forge approve.`
        : 'No approval stamp. Approve the set in the GUI or with forge approve before rendering for upload.',
      3,
    )
  }
  return renderProject({ project, repoRoot, targetIds: opts.targetIds, localeIds: opts.localeIds })
}

export async function approveCommand(opts: {
  projectDir: string
  setId: string
  by: string
}): Promise<Approval> {
  const { project, exists, bytes, artExists, artBytes } = await load(opts.projectDir, opts.setId)
  assertValid(validateProject(project, exists, artExists))
  const approval: Approval = {
    hash: await approvalHash(project, bytes, artBytes),
    by: opts.by,
    at: new Date().toISOString(),
  }
  project.set.approval = approval
  await writeProject(opts.projectDir, project)
  return approval
}
