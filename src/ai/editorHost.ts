import { getSize } from '../presets/sizes'
import { sceneSources } from '../lib/export'
import { artworkIdFor, backgroundIdFor, imageIdFor, screensFor, settingsFor } from '../project/bridge'
import {
  eyebrowFitsChecker,
  listFitsChecker,
  textBackdropChecker,
  textBlockChecker,
  type ContextFactory,
} from '../project/checkers'
import { ToolError, type PreviewFile, type ToolHost } from '../project/tools'
import { backgroundImageSrcs, type Project } from '../project/types'
import { validateProject, type Issue } from '../project/validate'
import { renderScene, sceneSpan } from '../render/scene'
import { nodesLookupOf, useStore } from '../store'

/** The long side of a preview tile the model looks at: enough to judge, cheap to send. */
export const PREVIEW_LONG_SIDE = 800

type EditorState = ReturnType<typeof useStore.getState>

export type EditorHostDeps = {
  state: () => EditorState
  check(state: EditorState): Issue[]
  preview(
    state: EditorState,
    opts: { slots?: string[]; locales?: string[]; targets?: string[] },
  ): Promise<PreviewFile[]>
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The tools' host inside the editor: the open set, written through the store exactly like a hand
 * edit (`applyAgentProject`: one undo step per job, the adapter's own save). Only the open set is
 * reachable; what needs a file system, a device or the network is not here.
 */
export function editorHost(jobKind: string, deps: EditorHostDeps = browserDeps): ToolHost {
  const open = () => {
    const project = deps.state().project
    if (!project) throw new ToolError('No set is open in the editor')
    return project
  }
  const load = async (setId: string) => {
    const project = open()
    if (setId !== project.set.id)
      throw new ToolError(`Only the open set "${project.set.id}" can be changed here, not "${setId}"`)
    return project
  }
  const refuse = (what: string) => () =>
    Promise.reject(new ToolError(`${what} is not available in the editor`))
  return {
    listSets: async () => [open().set.id],
    load,
    async save(project) {
      if (project.set.id !== open().set.id) throw new ToolError('A tool tried to write another set')
      await deps.state().applyAgentProject(project, jobKind)
    },
    create: refuse('Creating a set'),
    async check(setId) {
      await load(setId)
      return deps.check(deps.state())
    },
    async gallery() {
      return deps.state().gallery
    },
    async preview(setId, opts) {
      await load(setId)
      return deps.preview(deps.state(), opts)
    },
    render: refuse('render'),
    async readGuidelines() {
      return deps.state().projectStore?.guidelines?.() ?? null
    },
    async writeGuidelines(text) {
      const store = deps.state().projectStore
      if (!store?.saveGuidelines) throw new ToolError('The guidelines are read-only here')
      await store.saveGuidelines(text)
    },
    today,
  }
}

/** Whether `remember` can write here, so it is only offered where it works. */
export const canRemember = (state: EditorState) => !!state.projectStore?.saveGuidelines

let measureCanvas: HTMLCanvasElement | null = null
let paintCanvas: HTMLCanvasElement | null = null

/** One canvas per purpose, resized per call: the checks run synchronously, each asks for a fresh
 *  context and is done with the previous one by then, and a canvas per tile and locale would hold
 *  hundreds of full-resolution bitmaps at once. */
function reused(which: 'measure' | 'paint'): ContextFactory {
  return (w, h) => {
    const canvas =
      which === 'measure'
        ? (measureCanvas ??= document.createElement('canvas'))
        : (paintCanvas ??= document.createElement('canvas'))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: which === 'paint' })
    if (!ctx) throw new Error('2D canvas unavailable')
    return ctx
  }
}

/** `forge check` against what the editor holds: the images it loaded stand for the files. */
export function editorCheck(state: EditorState): Issue[] {
  const project = state.project as Project
  const { images, gallery } = state
  const backgrounds = new Map<string, CanvasImageSource>()
  for (const src of backgroundImageSrcs(project.set)) {
    const img = images[backgroundIdFor(src)]
    if (img) backgrounds.set(src, img)
  }
  const measure = reused('measure')
  return validateProject(
    project,
    (l, s) => !!images[imageIdFor(l, s)] || !!gallery[l]?.screens.includes(s),
    (l, a) => !!images[artworkIdFor(l, a)] || !!gallery[l]?.artwork.includes(a),
    eyebrowFitsChecker(project, measure),
    (l, a) => {
      const img = images[artworkIdFor(l, a)]
      return img?.naturalWidth ? img.naturalWidth / img.naturalHeight : null
    },
    listFitsChecker(project, measure),
    textBlockChecker(project, measure),
    nodesLookupOf(state.nodes),
    (src) => !!images[backgroundIdFor(src)],
    textBackdropChecker(project, backgrounds, reused('paint')),
  )
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** The real renderer at full size, each tile then scaled down to `PREVIEW_LONG_SIDE`. */
export async function editorPreview(
  state: EditorState,
  opts: { slots?: string[]; locales?: string[]; targets?: string[] },
): Promise<PreviewFile[]> {
  const project = state.project as Project
  const files: PreviewFile[] = []
  const canvas = document.createElement('canvas')
  const thumb = document.createElement('canvas')
  for (const target of project.set.targets.filter((t) => !opts.targets || opts.targets.includes(t.id))) {
    const settings = settingsFor(project, target.id)
    const size = getSize(settings.sizeId)
    const scale = Math.min(1, PREVIEW_LONG_SIDE / Math.max(size.w, size.h))
    thumb.width = Math.round(size.w * scale)
    thumb.height = Math.round(size.h * scale)
    for (const locale of project.set.locales.filter((l) => !opts.locales || opts.locales.includes(l.id))) {
      const screens = screensFor(project, locale.id, nodesLookupOf(state.nodes))
      for (const [i, screen] of screens.entries()) {
        if (opts.slots && !opts.slots.includes(screen.id)) continue
        const span = sceneSpan(screen, settings)
        canvas.width = size.w * span
        canvas.height = size.h
        const ctx = canvas.getContext('2d', { alpha: false })
        const tctx = thumb.getContext('2d', { alpha: false })
        if (!ctx || !tctx) throw new Error('2D canvas unavailable')
        renderScene(ctx, size.w, size.h, screen, settings, sceneSources(screens, i, state.images))
        for (let part = 1; part <= span; part++) {
          tctx.imageSmoothingQuality = 'high'
          tctx.drawImage(canvas, (part - 1) * size.w, 0, size.w, size.h, 0, 0, thumb.width, thumb.height)
          const blob = await new Promise<Blob>((resolve, reject) =>
            thumb.toBlob((b) => (b ? resolve(b) : reject(new Error('Preview export failed'))), 'image/png'),
          )
          const name = span > 1 ? `${screen.id}-${part}` : screen.id
          files.push({
            slot: screen.id,
            locale: locale.id,
            target: target.id,
            part,
            file: `${target.id}/${locale.id}/${name}.png`,
            image: {
              mediaType: 'image/png',
              base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
              width: thumb.width,
              height: thumb.height,
            },
          })
        }
      }
    }
  }
  return files
}

const browserDeps: EditorHostDeps = {
  state: () => useStore.getState(),
  check: editorCheck,
  preview: editorPreview,
}
