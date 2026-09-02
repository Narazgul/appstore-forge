import { useEffect, useRef } from 'react'
import { screensFor } from '../project/bridge'
import { renderScene, sceneSpan } from '../render/scene'
import { getSize } from '../presets/sizes'
import { useStore } from '../store'
import type { Screen, Settings } from '../types'

const TILE = 150

function Tile({
  screen,
  screens,
  settings,
  images,
}: {
  screen: Screen
  screens: Screen[]
  settings: Settings
  images: Record<string, HTMLImageElement>
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const size = getSize(settings.sizeId)
  const h = Math.round((TILE * size.h) / size.w)
  const span = sceneSpan(screen, settings)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(TILE * span * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const i = screens.findIndex((s) => s.id === screen.id)
    const at = (k: number) => images[screens[(k + screens.length) % screens.length]?.imageId ?? ''] ?? null
    renderScene(ctx, TILE, h, screen, settings, { self: at(i), next: at(i + 1), prev: at(i - 1) })
  }, [screen, screens, settings, images, h, span])

  return <canvas ref={ref} style={{ width: TILE * span, height: h }} className="block rounded-lg" />
}

/** Every language as one row, every slot as one column, rendered for the active target. */
export function LocaleGrid() {
  const project = useStore((s) => s.project)
  const settings = useStore((s) => s.settings)
  const images = useStore((s) => s.images)
  if (!project) return null
  return (
    <div className="flex flex-col gap-4">
      {project.set.locales.map((l) => {
        const screens = screensFor(project, l.id)
        return (
          <div key={l.id} className="flex items-start gap-3">
            <span className="w-12 pt-2 text-[12px] font-semibold">{l.id}</span>
            <div className="flex gap-3 overflow-x-auto">
              {screens.map((s) => (
                <Tile key={s.id} screen={s} screens={screens} settings={settings} images={images} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
