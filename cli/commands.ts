import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sourcePath } from '../src/project/bridge'
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
  return { repoRoot, project, exists, bytes }
}

function assertValid(issues: Issue[]) {
  const errors = issues.filter((i) => i.level === 'error')
  if (errors.length) throw new CliError(errors.map(formatIssue).join('\n'), 2)
}

async function approvalMatches(project: Project, bytes: (l: string, s: string) => Promise<Uint8Array>) {
  if (!project.set.approval) return false
  return (await approvalHash(project, bytes)) === project.set.approval.hash
}

export async function checkCommand(opts: { projectDir: string; setId: string; requireApproval: boolean }) {
  const { project, exists, bytes } = await load(opts.projectDir, opts.setId)
  const issues = validateProject(project, exists)
  const approvalOk =
    opts.requireApproval && !issues.some((i) => i.level === 'error')
      ? await approvalMatches(project, bytes)
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
  const { repoRoot, project, exists, bytes } = await load(opts.projectDir, opts.setId)
  assertValid(validateProject(project, exists))
  if (opts.requireApproval && !(await approvalMatches(project, bytes))) {
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
  const { project, exists, bytes } = await load(opts.projectDir, opts.setId)
  assertValid(validateProject(project, exists))
  const approval: Approval = {
    hash: await approvalHash(project, bytes),
    by: opts.by,
    at: new Date().toISOString(),
  }
  project.set.approval = approval
  await writeProject(opts.projectDir, project)
  return approval
}
