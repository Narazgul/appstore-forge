import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { effectiveSettings } from '../src/lib/settings'
import { getLayout } from '../src/presets/layouts'
import { getSize } from '../src/presets/sizes'
import { artworkPath, screensFor, settingsFor, sourcePath } from '../src/project/bridge'
import { approvalHash } from '../src/project/hash'
import { isSlotSticker } from '../src/project/types'
import type { Approval, Project } from '../src/project/types'
import { validateProject, type Issue } from '../src/project/validate'
import { sceneSpan } from '../src/render/scene'
import { measureTextBlock, type TextMeasurer } from '../src/render/text'
import { CliError } from './errors'
import { registerFonts } from './fonts'
import { readProject, repoRootOf, writeProject } from './project-io'
import { renderProject } from './render'

/**
 * Whether each slot's eyebrow fits its box on one line, per locale, at the size the block
 * settles on for each target. A slot fits only if it does for every target the set renders —
 * one target's copy shrinks the text differently than another's.
 */
function eyebrowFitsChecker(project: Project): (localeId: string, slotId: string) => boolean {
  registerFonts()
  const fits = new Map<string, boolean>()
  for (const target of project.set.targets) {
    const settings = settingsFor(project, target.id)
    const size = getSize(settings.sizeId)
    for (const locale of project.set.locales) {
      for (const screen of screensFor(project, locale.id)) {
        if (!screen.eyebrow) continue
        const resolved = effectiveSettings(screen, settings)
        const span = sceneSpan(screen, settings)
        const ctx = createCanvas(size.w * span, size.h).getContext('2d') as unknown as TextMeasurer
        const block = measureTextBlock(
          ctx,
          size.w * span,
          size.w,
          size.h,
          getLayout(resolved.layout),
          screen,
          resolved,
        )
        const key = `${locale.id}:${screen.id}`
        fits.set(key, (fits.get(key) ?? true) && (!block || block.eyebrowFits))
      }
    }
  }
  return (localeId, slotId) => fits.get(`${localeId}:${slotId}`) ?? true
}

/**
 * A sticker's real aspect ratio, per locale, when the file is on disk — the check then draws its
 * text-band overlap warning from the actual image instead of assuming a square. A missing file is
 * already reported by `validateProject` itself, so this stays silent about it.
 */
async function elementAspectChecker(
  project: Project,
  repoRoot: string,
): Promise<(localeId: string, artwork: string) => number | null> {
  const aspects = new Map<string, number>()
  for (const locale of project.set.locales) {
    for (const slot of project.set.slots) {
      for (const el of (slot.elements ?? []).filter(isSlotSticker)) {
        const key = `${locale.id}:${el.artwork}`
        if (aspects.has(key)) continue
        const path = join(repoRoot, artworkPath(project.set, locale.id, el.artwork))
        if (!existsSync(path)) continue
        const img = await loadImage(path)
        aspects.set(key, img.width / img.height)
      }
    }
  }
  return (localeId, artwork) => aspects.get(`${localeId}:${artwork}`) ?? null
}

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
  const { repoRoot, project, exists, bytes, artExists, artBytes } = await load(opts.projectDir, opts.setId)
  const issues = validateProject(
    project,
    exists,
    artExists,
    eyebrowFitsChecker(project),
    await elementAspectChecker(project, repoRoot),
  )
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
  assertValid(
    validateProject(
      project,
      exists,
      artExists,
      eyebrowFitsChecker(project),
      await elementAspectChecker(project, repoRoot),
    ),
  )
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
  const { repoRoot, project, exists, bytes, artExists, artBytes } = await load(opts.projectDir, opts.setId)
  assertValid(
    validateProject(
      project,
      exists,
      artExists,
      eyebrowFitsChecker(project),
      await elementAspectChecker(project, repoRoot),
    ),
  )
  const approval: Approval = {
    hash: await approvalHash(project, bytes, artBytes),
    by: opts.by,
    at: new Date().toISOString(),
  }
  project.set.approval = approval
  await writeProject(opts.projectDir, project)
  return approval
}
