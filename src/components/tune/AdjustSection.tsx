import { DEVICE_SCALE_RANGE, TILT_LIMIT } from '../../lib/canvasEdit'
import { OffsetRow, Row } from './Controls'
import type { SectionProps } from './shared'

/** Final nudges to the device frame itself: rotation, size and where the arrangement sits. The
 *  canvas handles write the same three keys and stop at the same limits. */
export function AdjustSection({ settings, put, owns, clear }: SectionProps) {
  return (
    <>
      <Row label={`Tilt ${settings.tilt}°`}>
        <input
          type="range"
          min={-TILT_LIMIT}
          max={TILT_LIMIT}
          value={settings.tilt}
          onChange={(e) => put({ tilt: Number(e.target.value) })}
        />
      </Row>
      <Row label={`Scale ${settings.deviceScale.toFixed(2)}`}>
        <input
          type="range"
          min={DEVICE_SCALE_RANGE.min}
          max={DEVICE_SCALE_RANGE.max}
          step={0.01}
          value={settings.deviceScale}
          onChange={(e) => put({ deviceScale: Number(e.target.value) })}
        />
      </Row>
      <OffsetRow
        offset={settings.deviceOffset}
        owned={owns?.('deviceOffset') ?? false}
        onReset={() => clear?.('deviceOffset')}
      />
    </>
  )
}
