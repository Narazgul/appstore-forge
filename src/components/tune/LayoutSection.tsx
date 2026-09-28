import { Glyph } from '../RhythmPicker'
import { frameAspect, getDevice } from '../../presets/devices'
import { LAYOUTS } from '../../presets/layouts'
import { POSITIONS } from '../../presets/positions'
import { useStore } from '../../store'
import { Row } from './Controls'
import type { SectionProps } from './shared'

/** One tile in glyph units, matching `RhythmPicker`'s. */
const TILE = { w: 46, h: 100 }

/** The composition: which band holds the copy, and how many devices sit in the frame. Each
 *  option shows a schematic of itself, drawn from the same geometry the renderer uses — a
 *  deviceless layout (`text-only`, `feature-wall`) simply shows no device box, since
 *  `composeDevices` already returns none for one, and the mosaic layout shows its own cell grid
 *  (`Glyph` in `RhythmPicker.tsx` sketches both from the same shared geometry). */
export function LayoutSection({ settings, put }: SectionProps) {
  const aspect = frameAspect(getDevice(settings.deviceId))
  // Mosaic's extra cells (2..n) are only ever set through a project slot's `SourcePicker` — there
  // is no freeform equivalent, so offering the layout there would strand a screen with a headline
  // band and nothing to fill the grid.
  const hasProject = useStore((s) => !!s.project)
  const layouts = hasProject ? LAYOUTS : LAYOUTS.filter((t) => t.id !== 'mosaic')
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        {layouts.map((t) => {
          const active = settings.layout === t.id
          const w = TILE.w * t.span
          return (
            <button
              key={t.id}
              className="flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[12px]"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--line)',
                color: active ? 'var(--accent)' : 'var(--ink)',
                background: active ? 'rgba(30,111,245,0.06)' : '#fff',
              }}
              onClick={() => put({ layout: t.id })}
            >
              <svg
                viewBox={`0 0 ${w} ${TILE.h}`}
                style={{ width: '60%', aspectRatio: `${w} / ${TILE.h}` }}
                aria-hidden
              >
                <Glyph
                  step={{ layout: t.id, positionId: settings.positionId, textAlign: settings.textAlign }}
                  x={0}
                  aspect={aspect}
                />
              </svg>
              {t.label}
            </button>
          )
        })}
      </div>
      <Row label="Devices">
        <select
          className="field"
          value={settings.positionId}
          onChange={(e) => put({ positionId: e.target.value })}
        >
          {POSITIONS.map((pos) => (
            <option key={pos.id} value={pos.id}>
              {pos.label}
            </option>
          ))}
        </select>
      </Row>
    </>
  )
}
