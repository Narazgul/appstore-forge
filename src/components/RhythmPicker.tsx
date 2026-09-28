import { frameAspect, getDevice } from '../presets/devices'
import { getLayout } from '../presets/layouts'
import { RHYTHMS } from '../presets/rhythms'
import { getTemplateSpec } from '../presets/templates'
import { composeDevices, mosaicCells } from '../render/scene'
import { useStore } from '../store'
import type { Rhythm, RhythmStep } from '../types'

/** A representative cell count for the mosaic glyph — any 4–6 count reads the same at this size. */
const GLYPH_MOSAIC_COUNT = 5

/** One store tile in glyph units; the ratio matches a 1320×2868 screenshot. */
const TILE = { w: 46, h: 100 }
const GAP = 4

/**
 * A schematic strip: copy as text bars, devices as rounded rectangles at their real size,
 * position and tilt — from the same geometry the renderer draws, so the picker shows the
 * compositions themselves rather than describing them.
 */
export function Glyph({ step, x, aspect }: { step: RhythmStep; x: number; aspect: number }) {
  const layout = getLayout(step.layout)
  const W = TILE.w * layout.span
  const bars: { x: number; y: number; w: number }[] = []
  if (layout.text) {
    const boxLeft = layout.text.left !== undefined ? W * layout.text.left : TILE.w * layout.padX
    const boxW = layout.text.width !== undefined ? W * layout.text.width : TILE.w * (1 - layout.padX * 2)
    const top = TILE.h * layout.text.top + 2
    for (const [i, f] of [0.78, 0.5].entries()) {
      const w = boxW * f
      bars.push({ x: step.textAlign === 'left' ? boxLeft : boxLeft + (boxW - w) / 2, y: top + i * 6.5, w })
    }
  }
  // `feature-wall`'s list band, sketched as a handful of short rows below the headline bars —
  // the same geometry the renderer reads, so the glyph shows the list rather than describing it.
  if (layout.list) {
    const boxLeft = layout.list.left !== undefined ? W * layout.list.left : TILE.w * layout.padX
    const boxW = layout.list.width !== undefined ? W * layout.list.width : TILE.w * (1 - layout.padX * 2)
    const top = TILE.h * layout.list.top + 2
    const rowGap = 6
    const rows = Math.min(5, Math.max(2, Math.floor((TILE.h * layout.list.height) / rowGap)))
    for (let i = 0; i < rows; i++) {
      const w = boxW * (i % 2 === 0 ? 0.62 : 0.46)
      bars.push({ x: step.textAlign === 'left' ? boxLeft : boxLeft + (boxW - w) / 2, y: top + i * rowGap, w })
    }
  }
  // The mosaic layout draws no device at all (its own grid instead), so it gets no boxes from
  // `composeDevices` — sketching it means the real cell geometry (`mosaicCells`) instead. Reusing
  // `aspect` (the device's *frame* aspect) rather than its screen aspect is a small, deliberate
  // approximation: the two are close enough that a glyph this size never shows the difference, and
  // it saves threading a second aspect prop through every caller for a schematic icon.
  const isMosaic = layout.id === 'mosaic'
  const devices = isMosaic ? [] : composeDevices(layout, step.positionId, TILE.w, TILE.h, aspect, 1, 0)
  const cells = isMosaic ? mosaicCells(layout, TILE.w, TILE.h, aspect, GLYPH_MOSAIC_COUNT) : []
  const clip = `glyph-${step.layout}-${step.positionId}-${x}`
  return (
    <g transform={`translate(${x} 0)`}>
      <clipPath id={clip}>
        <rect width={W} height={TILE.h} rx={2} />
      </clipPath>
      <rect width={W} height={TILE.h} rx={2} fill="var(--shell)" />
      <g clipPath={`url(#${clip})`}>
        {bars.map((b) => (
          <rect key={b.y} x={b.x} y={b.y} width={b.w} height={4} rx={2} fill="rgba(22,22,26,0.28)" />
        ))}
        {devices.map((d, i) => (
          <rect
            key={i}
            x={d.box.x}
            y={d.box.y}
            width={d.box.w}
            height={d.box.h}
            rx={d.box.w * 0.15}
            fill={d.source === 'self' ? 'rgba(22,22,26,0.82)' : 'rgba(22,22,26,0.42)'}
            transform={`rotate(${d.angle} ${d.box.x + d.box.w / 2} ${d.box.y + d.box.h / 2})`}
          />
        ))}
        {cells.map((b, i) => (
          // The tile's own clipPath (above) crops a cell that bleeds off the bottom, exactly as
          // the export does — no separate truncation needed here.
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={b.w * 0.15}
            fill={i === 0 ? 'rgba(22,22,26,0.82)' : 'rgba(22,22,26,0.42)'}
          />
        ))}
      </g>
      {layout.span > 1 && (
        <line x1={TILE.w} y1={0} x2={TILE.w} y2={TILE.h} stroke="var(--panel)" strokeWidth={1.5} />
      )}
    </g>
  )
}

export function RhythmGlyphs({ steps, aspect }: { steps: RhythmStep[]; aspect: number }) {
  // Each tile starts where the previous ones ended; a span-2 layout takes two tiles of room.
  const tiles = steps.map((step, i) => ({
    step,
    key: `${step.layout}-${i}`,
    x: steps.slice(0, i).reduce((acc, prev) => acc + TILE.w * getLayout(prev.layout).span + GAP, 0),
  }))
  const last = tiles.at(-1)
  const width = last ? last.x + TILE.w * getLayout(last.step.layout).span : TILE.w
  return (
    <svg
      viewBox={`0 0 ${width} ${TILE.h}`}
      style={{ width: '100%', aspectRatio: `${width} / ${TILE.h}` }}
      aria-hidden
    >
      {tiles.map((t) => (
        <Glyph key={t.key} step={t.step} x={t.x} aspect={aspect} />
      ))}
    </svg>
  )
}

/** The steps a rhythm shows in its glyph: uniform sketches the global layout five times. */
function glyphSteps(rhythm: Rhythm, fallback: RhythmStep): RhythmStep[] {
  return rhythm.steps.length ? rhythm.steps : Array(5).fill(fallback)
}

/**
 * Goldie's template dropdown, on our model and laid out flat: pick the strip's rhythm without
 * touching the look. Each option is a picture of the strip it produces.
 */
export function RhythmOptions() {
  const rhythmId = useStore((s) => s.rhythmId)
  const applyRhythm = useStore((s) => s.applyRhythm)
  const applyTemplate = useStore((s) => s.applyTemplate)
  const settings = useStore((s) => s.settings)
  const template = useStore((s) => getTemplateSpec(s.templateId))
  const aspect = frameAspect(getDevice(settings.deviceId))
  const fallback: RhythmStep = {
    layout: settings.layout,
    positionId: settings.positionId,
    textAlign: settings.textAlign,
  }

  const options: { id: string; label: string; description: string; steps: RhythmStep[] }[] = RHYTHMS.map(
    (r) => ({
      ...r,
      steps: glyphSteps(r, fallback),
    }),
  )
  // A template whose variants carry their own compositions shows up as its own option.
  if (template.variants?.length && !template.rhythm) {
    options.splice(1, 0, {
      id: 'template',
      label: `${template.label}'s own`,
      description: 'The compositions this template ships with.',
      steps: template.variants.map((v) => ({
        layout: v.layout ?? settings.layout,
        positionId: v.positionId ?? settings.positionId,
        textAlign: v.textAlign ?? settings.textAlign,
      })),
    })
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
      {options.map((o) => (
        <button
          key={o.id}
          className="option-card"
          data-active={o.id === rhythmId}
          onClick={() => (o.id === 'template' ? applyTemplate(template.id) : applyRhythm(o.id))}
        >
          <RhythmGlyphs steps={o.steps} aspect={aspect} />
          <span className="mt-2 flex items-baseline justify-between">
            <span className="text-[13px] font-semibold">{o.label}</span>
            {o.id === rhythmId && <span className="pill">Current</span>}
          </span>
          <span className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
            {o.description}
          </span>
        </button>
      ))}
    </div>
  )
}
