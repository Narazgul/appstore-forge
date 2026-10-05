import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { artworkPath, nodesPath, sourcePath } from '../src/project/bridge'
import {
  eyebrowFitsChecker,
  headlineFitsChecker,
  listFitsChecker,
  textBackdropChecker,
  textBlockChecker,
  type ContextFactory,
} from '../src/project/checkers'
import { imageOpaqueBounds } from '../src/lib/opaqueBounds'
import { approvalHash } from '../src/project/hash'
import { backgroundImageSrcs, isSlotSticker, isStudioSet } from '../src/project/types'
import type { Approval, Project } from '../src/project/types'
import { validateProject, type Band, type Issue } from '../src/project/validate'
import { CliError } from './errors'
import { registerFonts } from './fonts'
import { readProject, repoRootOf, writeProject } from './project-io'
import { nodesLookup, renderProject } from './render'

const skia: ContextFactory = (w, h) => {
  registerFonts()
  return createCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D
}

async function backgroundImages(project: Project, repoRoot: string) {
  const images = new Map<string, CanvasImageSource>()
  for (const src of backgroundImageSrcs(project.set)) {
    const path = join(repoRoot, src)
    if (existsSync(path)) images.set(src, (await loadImage(path)) as unknown as CanvasImageSource)
  }
  return images
}

/**
 * A sticker's real aspect ratio, per locale, when the file is on disk — the check then draws its
 * text-band overlap warning from the actual image instead of assuming a square. A missing file is
 * already reported by `validateProject` itself, so this stays silent about it.
 */
async function elementAspectChecker(
  project: Project,
  repoRoot: string,
): Promise<{
  aspect: (localeId: string, artwork: string) => number | null
  opaque: (localeId: string, artwork: string) => Band | null
}> {
  const aspects = new Map<string, number>()
  const drawn = new Map<string, Band | null>()
  for (const locale of project.set.locales) {
    for (const slot of project.set.slots) {
      // A hand-edited project file may give `elements` the wrong JSON shape; `validateProject`
      // reports that on its own, but this runs ahead of it (see `checkCommand`), so a wrong type
      // must fall back to "none" here rather than throw `.filter` on a non-array.
      for (const el of (Array.isArray(slot.elements) ? slot.elements : []).filter(isSlotSticker)) {
        const key = `${locale.id}:${el.artwork}`
        if (aspects.has(key)) continue
        const path = join(repoRoot, artworkPath(project.set, locale.id, el.artwork))
        if (!existsSync(path)) continue
        const img = await loadImage(path)
        aspects.set(key, img.width / img.height)
        drawn.set(key, imageOpaqueBounds(img as unknown as CanvasImageSource & Size, skia))
      }
    }
  }
  return {
    aspect: (localeId, artwork) => aspects.get(`${localeId}:${artwork}`) ?? null,
    opaque: (localeId, artwork) => drawn.get(`${localeId}:${artwork}`) ?? null,
  }
}

type Size = { width: number; height: number }

async function validateLoaded(
  project: Project,
  repoRoot: string,
  exists: (locale: string, screen: string) => boolean,
  artExists: (locale: string, artwork: string) => boolean,
  bgExists: (src: string) => boolean,
) {
  const art = await elementAspectChecker(project, repoRoot)
  return validateProject(
    project,
    exists,
    artExists,
    eyebrowFitsChecker(project, skia),
    art.aspect,
    listFitsChecker(project, skia),
    textBlockChecker(project, skia),
    nodesLookup(repoRoot, project.set),
    bgExists,
    textBackdropChecker(project, await backgroundImages(project, repoRoot), skia),
    art.opaque,
    headlineFitsChecker(project, skia),
  )
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
  const nodesBytes = async (locale: string, screen: string) => {
    const path = join(repoRoot, nodesPath(project.set, locale, screen))
    return existsSync(path) ? new Uint8Array(await readFile(path)) : new Uint8Array()
  }
  const bgExists = (src: string) => existsSync(join(repoRoot, src))
  const bgBytes = async (src: string) => new Uint8Array(await readFile(join(repoRoot, src)))
  return { repoRoot, project, exists, bytes, artExists, artBytes, nodesBytes, bgExists, bgBytes }
}

function assertValid(issues: Issue[]) {
  const errors = issues.filter((i) => i.level === 'error')
  if (errors.length) throw new CliError(errors.map(formatIssue).join('\n'), 2)
}

type Bytes = (a: string, b: string) => Promise<Uint8Array>

async function approvalMatches(
  project: Project,
  bytes: Bytes,
  artBytes: Bytes,
  nodesBytes: Bytes,
  bgBytes: (src: string) => Promise<Uint8Array>,
) {
  if (!project.set.approval) return false
  return (await approvalHash(project, bytes, artBytes, nodesBytes, bgBytes)) === project.set.approval.hash
}

export async function checkCommand(opts: { projectDir: string; setId: string; requireApproval: boolean }) {
  const { repoRoot, project, exists, bytes, artExists, artBytes, nodesBytes, bgExists, bgBytes } = await load(
    opts.projectDir,
    opts.setId,
  )
  const issues = await validateLoaded(project, repoRoot, exists, artExists, bgExists)
  // A studio set carries no stamp: there is nothing to approve it for.
  const approvalOk =
    opts.requireApproval && !isStudioSet(project.set) && !issues.some((i) => i.level === 'error')
      ? await approvalMatches(project, bytes, artBytes, nodesBytes, bgBytes)
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
  const { repoRoot, project, exists, bytes, artExists, artBytes, nodesBytes, bgExists, bgBytes } = await load(
    opts.projectDir,
    opts.setId,
  )
  assertValid(await validateLoaded(project, repoRoot, exists, artExists, bgExists))
  if (
    opts.requireApproval &&
    !isStudioSet(project.set) &&
    !(await approvalMatches(project, bytes, artBytes, nodesBytes, bgBytes))
  ) {
    throw new CliError(
      project.set.approval
        ? `Approval of ${project.set.approval.at} no longer matches: set, copy or a source image changed since. Approve again with forge approve.`
        : 'No approval stamp. Approve the set with forge approve before rendering for upload.',
      3,
    )
  }
  return renderProject({ project, repoRoot, targetIds: opts.targetIds, localeIds: opts.localeIds })
}

export async function approveCommand(opts: { projectDir: string; setId: string }): Promise<Approval> {
  const { repoRoot, project, exists, bytes, artExists, artBytes, nodesBytes, bgExists, bgBytes } = await load(
    opts.projectDir,
    opts.setId,
  )
  if (isStudioSet(project.set)) throw new CliError('A studio set carries no approval; render it directly.', 1)
  assertValid(await validateLoaded(project, repoRoot, exists, artExists, bgExists))
  const approval: Approval = {
    hash: await approvalHash(project, bytes, artBytes, nodesBytes, bgBytes),
    at: new Date().toISOString(),
  }
  project.set.approval = approval
  await writeProject(opts.projectDir, project)
  return approval
}
