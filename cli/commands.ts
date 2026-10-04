import { createCanvas, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { effectiveSettings } from '../src/lib/settings'
import { getLayout } from '../src/presets/layouts'
import { getSize } from '../src/presets/sizes'
import { artworkPath, nodesPath, screensFor, settingsFor, sourcePath } from '../src/project/bridge'
import { approvalHash } from '../src/project/hash'
import { isSlotSticker, isStudioSet } from '../src/project/types'
import type { Approval, Project } from '../src/project/types'
import { validateProject, type Issue, type TextBlockProbe } from '../src/project/validate'
import { sceneSpan, textShifts } from '../src/render/scene'
import {
  headlineBaseSize,
  LIST_CAP_MULT,
  measureListBlock,
  measureTextBlock,
  textBlockBox,
  type TextMeasurer,
} from '../src/render/text'
import type { Screen } from '../src/types'
import { CliError } from './errors'
import { registerFonts } from './fonts'
import { readProject, repoRootOf, writeProject } from './project-io'
import { nodesLookup, renderProject } from './render'

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
 * Whether each `feature-wall` slot's list fits its band, per locale, at the size it settles on
 * for each target — the same shape as `eyebrowFitsChecker`, capped the same way `render/scene.ts`
 * caps it (the headline's own base size × `LIST_CAP_MULT`).
 */
function listFitsChecker(project: Project): (localeId: string, slotId: string) => boolean {
  registerFonts()
  const fits = new Map<string, boolean>()
  for (const target of project.set.targets) {
    const settings = settingsFor(project, target.id)
    const size = getSize(settings.sizeId)
    for (const locale of project.set.locales) {
      for (const screen of screensFor(project, locale.id)) {
        if (!screen.list?.length) continue
        const resolved = effectiveSettings(screen, settings)
        const layout = getLayout(resolved.layout)
        const span = sceneSpan(screen, settings)
        const ctx = createCanvas(size.w * span, size.h).getContext('2d') as unknown as TextMeasurer
        const capSize = headlineBaseSize(size.h, resolved, layout.textScale) * LIST_CAP_MULT
        const block = measureListBlock(ctx, size.w * span, size.w, size.h, layout, screen, resolved, capSize)
        const key = `${locale.id}:${screen.id}`
        fits.set(key, (fits.get(key) ?? true) && (!block || block.fits))
      }
    }
  }
  return (localeId, slotId) => fits.get(`${localeId}:${slotId}`) ?? true
}

/**
 * Where each slot's text block really lands, per locale, for every target: the renderer's own
 * `textShifts` + `textBlockBox`, called the way `render/targets.ts` frames the copy in the editor,
 * so `validateProject`'s headline checks see `textOffset` and `feature-wall`'s centring. Measured
 * only when asked — just the slots with a front sticker or a moved text block ever are.
 */
function textBlockChecker(project: Project): (localeId: string, slotId: string) => TextBlockProbe[] {
  registerFonts()
  const screens = new Map<string, Screen[]>()
  const measured = new Map<string, TextBlockProbe[]>()
  return (localeId, slotId) => {
    const key = `${localeId}:${slotId}`
    const known = measured.get(key)
    if (known) return known
    if (!screens.has(localeId)) screens.set(localeId, screensFor(project, localeId))
    const screen = screens.get(localeId)!.find((s) => s.id === slotId)
    if (!screen) return []
    const probes: TextBlockProbe[] = []
    for (const target of project.set.targets) {
      const settings = settingsFor(project, target.id)
      const size = getSize(settings.sizeId)
      const resolved = effectiveSettings(screen, settings)
      const layout = getLayout(resolved.layout)
      const W = size.w * layout.span
      const ctx = createCanvas(W, size.h).getContext('2d') as unknown as TextMeasurer
      const shifts = textShifts(ctx, W, size.w, size.h, layout, screen, resolved)
      const box = textBlockBox(ctx, W, size.w, size.h, layout, screen, resolved, shifts.text)
      if (!box) continue
      probes.push({
        tileAspect: size.w / size.h,
        box: {
          left: box.x / W,
          right: (box.x + box.w) / W,
          top: box.y / size.h,
          bottom: (box.y + box.h) / size.h,
        },
      })
    }
    measured.set(key, probes)
    return probes
  }
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
  const issues = validateProject(
    project,
    exists,
    artExists,
    eyebrowFitsChecker(project),
    await elementAspectChecker(project, repoRoot),
    listFitsChecker(project),
    textBlockChecker(project),
    nodesLookup(repoRoot, project.set),
    bgExists,
  )
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
  assertValid(
    validateProject(
      project,
      exists,
      artExists,
      eyebrowFitsChecker(project),
      await elementAspectChecker(project, repoRoot),
      listFitsChecker(project),
      textBlockChecker(project),
      nodesLookup(repoRoot, project.set),
      bgExists,
    ),
  )
  if (
    opts.requireApproval &&
    !isStudioSet(project.set) &&
    !(await approvalMatches(project, bytes, artBytes, nodesBytes, bgBytes))
  ) {
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
  const { repoRoot, project, exists, bytes, artExists, artBytes, nodesBytes, bgExists, bgBytes } = await load(
    opts.projectDir,
    opts.setId,
  )
  if (isStudioSet(project.set)) throw new CliError('A studio set carries no approval; render it directly.', 1)
  assertValid(
    validateProject(
      project,
      exists,
      artExists,
      eyebrowFitsChecker(project),
      await elementAspectChecker(project, repoRoot),
      listFitsChecker(project),
      textBlockChecker(project),
      nodesLookup(repoRoot, project.set),
      bgExists,
    ),
  )
  const approval: Approval = {
    hash: await approvalHash(project, bytes, artBytes, nodesBytes, bgBytes),
    by: opts.by,
    at: new Date().toISOString(),
  }
  project.set.approval = approval
  await writeProject(opts.projectDir, project)
  return approval
}
