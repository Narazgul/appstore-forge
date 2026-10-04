import { DEVICES, DEVICE_GROUPS, FRAME_COLORS, getDevice } from '../../presets/devices'
import { getPosition } from '../../presets/positions'
import type { DeviceFade, DeviceShadow } from '../../types'
import { Row } from './Controls'
import type { SectionProps } from './shared'

const SHADOW_OPTIONS: { id: DeviceShadow; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'soft', label: 'Soft' },
  { id: 'hard', label: 'Hard' },
]

const FADE_OPTIONS: { id: DeviceFade | 'off'; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'dark', label: 'Dark' },
  { id: 'background', label: 'Background' },
]

/** Which device frame the screenshots sit in, what colour its body is, and the drop shadow it casts. */
export function DeviceSection({ settings, put, turnOff }: SectionProps) {
  const browser = getDevice(settings.deviceId).toolbar !== undefined
  const framed = settings.layout !== 'mosaic'
  const several = framed && getPosition(settings.positionId).placements.length > 1
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
      {browser && (
        <Row label="Address">
          <input
            className="field"
            data-control="browserUrl"
            value={settings.browserUrl ?? ''}
            placeholder="Empty"
            onChange={(e) => (e.target.value ? put({ browserUrl: e.target.value }) : turnOff?.('browserUrl'))}
          />
        </Row>
      )}
      {several && (
        <Row label="Back blur">
          <div className="flex flex-1 gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
            <button
              className="seg"
              data-active={!settings.backBlur}
              onClick={() => settings.backBlur && turnOff?.('backBlur')}
            >
              Off
            </button>
            <button className="seg" data-active={!!settings.backBlur} onClick={() => put({ backBlur: true })}>
              Blur back devices
            </button>
          </div>
        </Row>
      )}
      {framed && (
        <Row label="Fade out">
          <select
            className="field"
            data-control="deviceFade"
            value={settings.deviceFade ?? 'off'}
            onChange={(e) =>
              e.target.value === 'off'
                ? turnOff?.('deviceFade')
                : put({ deviceFade: e.target.value as DeviceFade })
            }
          >
            {FADE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
      )}
    </>
  )
}
