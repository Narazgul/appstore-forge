import { useEffect, useMemo, useRef, useState } from 'react'
import { screenWithEdit, type CanvasEdit } from '../lib/canvasEdit'
import { renderScene, sceneSpan } from '../render/scene'
import { useSceneSources } from '../lib/useSceneSources'
import { useStore } from '../store'
import type { Screen } from '../types'
import { CanvasEditor } from './CanvasEditor'

/**
 * `width`/`height` are one store tile; a span-2 composition renders twice as wide with a seam marker.
 * `screens` names the strip the screen belongs to — the review page draws languages the store is
 * not currently showing, whose neighbours are not the ones in the store. `editable` lays the canvas
 * editor over it (`CanvasEditor`); its live edit is drawn here, through the same `renderScene`.
 */
export function ScreenPreview({
  screen,
  screens,
  width,
  height,
  editable = false,
}: {
  screen: Screen
  screens?: Screen[]
  width: number
  height: number
  editable?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const settings = useStore((s) => s.settings)
  const [edit, setEdit] = useState<CanvasEdit | null>(null)
  const shown = useMemo(() => (edit ? screenWithEdit(screen, edit) : screen), [screen, edit])
  const sources = useSceneSources(shown, screens)
  const span = sceneSpan(shown, settings)
  const fullWidth = width * span

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(fullWidth * dpr)
    canvas.height = Math.round(height * dpr)
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderScene(ctx, width, height, shown, settings, sources)
  }, [shown, settings, sources, width, height, fullWidth])

  return (
    <div className="relative" style={{ width: fullWidth, height }}>
      <canvas ref={ref} style={{ width: fullWidth, height }} className="block rounded-xl" />
      {span > 1 && <div className="seam" style={{ left: width }} title="The store shows this as two tiles" />}
      {editable && (
        <CanvasEditor
          screen={screen}
          shown={shown}
          settings={settings}
          sources={sources}
          width={width}
          height={height}
          span={span}
          onEdit={setEdit}
        />
      )}
    </div>
  )
}
