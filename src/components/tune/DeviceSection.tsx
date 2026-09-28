import { DEVICES, DEVICE_GROUPS, FRAME_COLORS } from '../../presets/devices'
import type { DeviceShadow } from '../../types'
import { Row } from './Controls'
import type { SectionProps } from './shared'

const SHADOW_OPTIONS: { id: DeviceShadow; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'soft', label: 'Soft' },
  { id: 'hard', label: 'Hard' },
]

/** Which device frame the screenshots sit in, what colour its body is, and the drop shadow it casts. */
export function DeviceSection({ settings, put }: SectionProps) {
  return (
    <>
      <select className="field" value={settings.deviceId} onChange={(e) => put({ deviceId: e.target.value })}>
        {DEVICE_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {DEVICES.filter((d) => d.group === group).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="grid grid-cols-8 gap-1.5">
        {FRAME_COLORS.map((c) => (
          <button
            key={c.id}
            title={c.label}
            className="swatch"
            style={{ background: `linear-gradient(140deg, ${c.edge}, ${c.body})` }}
            data-active={settings.frameColorId === c.id}
            onClick={() => put({ frameColorId: c.id })}
          />
        ))}
      </div>
      <Row label="Shadow">
        <div className="flex flex-1 gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
          {SHADOW_OPTIONS.map((o) => (
            <button
              key={o.id}
              className="seg"
              data-active={settings.deviceShadow === o.id}
              onClick={() => put({ deviceShadow: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Row>
    </>
  )
}
