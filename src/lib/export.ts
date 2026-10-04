import { zipSync } from 'fflate'
import { renderScene, sceneSpan } from '../render/scene'
import { stripMarkup } from '../render/text'
import { getSize } from '../presets/sizes'
import { isStickerElement } from '../types'
import type { Screen, Settings } from '../types'
import { backgroundIdFor } from '../project/bridge'

const BACKGROUND_PREFIX = backgroundIdFor('')

export type ExportResult = { kind: 'downloaded'; count: number }

const slug = (text: string, fallback: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || fallback

function toBlob(canvas: HTMLCanvasElement, format: 'png' | 'jpeg'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      format === 'png' ? 'image/png' : 'image/jpeg',
      format === 'png' ? undefined : 0.95,
    )
  })
}

/** Render every screen at full store resolution. Delivery is the caller's problem. */
export async function renderAll(
  screens: Screen[],
  settings: Settings,
  images: Record<string, HTMLImageElement>,
  format: 'png' | 'jpeg',
) {
  const size = getSize(settings.sizeId)
  const canvas = document.createElement('canvas')
  canvas.height = size.h
  const tile = document.createElement('canvas')
  tile.width = size.w
  tile.height = size.h
  const tileCtx = tile.getContext('2d', { alpha: false })
  if (!tileCtx) throw new Error('2D canvas unavailable')

  // Same neighbour-wrapping the preview uses, so multi-device arrangements export identically.
  const imageAt = (i: number) => {
    const target = screens[(i + screens.length) % (screens.length || 1)]
    return target?.imageId ? (images[target.imageId] ?? null) : null
  }

  const files: { name: string; data: Uint8Array }[] = []
  let tileIndex = 0
  for (const [i, screen] of screens.entries()) {
    // A panorama is drawn once at span × width and sliced into store tiles, numbered in
    // store order so the files upload as consecutive slots.
    const span = sceneSpan(screen, settings)
    canvas.width = size.w * span
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas unavailable')
    // A named pair/artwork/sticker/mosaic-cell replaces the neighbour lookup, exactly as the
    // preview resolves it (`useSceneSources`) — a plain neighbour-wrapping arrangement still
    // works with no project fields set at all, which is all freeform mode ever has.
    renderScene(ctx, size.w, size.h, screen, settings, {
      self: imageAt(i),
      next: screen.pairId ? (images[screen.pairId] ?? null) : imageAt(i + 1),
      prev: screen.pairPrevId ? (images[screen.pairPrevId] ?? null) : imageAt(i - 1),
      artwork: screen.artworkId ? (images[screen.artworkId] ?? null) : null,
      elements: Object.fromEntries(
        (screen.elements ?? [])
          .filter(isStickerElement)
          .map((el) => [el.imageId, images[el.imageId] ?? null]),
      ),
      extra: screen.extraIds?.map((id) => images[id] ?? null),
      backgrounds: Object.fromEntries(
        Object.entries(images)
          .filter(([key]) => key.startsWith(BACKGROUND_PREFIX))
          .map(([key, img]) => [key.slice(BACKGROUND_PREFIX.length), img]),
      ),
    })
    for (let part = 0; part < span; part++) {
      tileCtx.drawImage(canvas, -part * size.w, 0)
      const blob = await toBlob(tile, format)
      const name = slug(stripMarkup(screen.headline), 'screen') + (span > 1 ? `-${part + 1}` : '')
      files.push({
        name: `${String(++tileIndex).padStart(2, '0')}-${name}.${format === 'png' ? 'png' : 'jpg'}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      })
    }
  }
  return { files, folder: `store-screenshots-${size.id}` }
}

export async function exportAll(
  screens: Screen[],
  settings: Settings,
  images: Record<string, HTMLImageElement>,
  format: 'png' | 'jpeg',
): Promise<ExportResult> {
  const { files, folder } = await renderAll(screens, settings, images, format)
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[`${folder}/${file.name}`] = file.data

  const zip = zipSync(entries, { level: 6 })
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${folder}.zip`
  a.click()
  URL.revokeObjectURL(url)
  return { kind: 'downloaded', count: files.length }
}

// Automation hook, mirroring `window.__store`: renders the real export at full store
// resolution without triggering a download, so the export path itself can be exercised
// by an agent or from the devtools console.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __renderExport: typeof renderAll }).__renderExport = renderAll
}
