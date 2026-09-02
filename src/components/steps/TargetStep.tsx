import { DEVICES, DEVICE_GROUPS, FRAME_COLORS } from '../../presets/devices'
import { EXPORT_SIZES, getSize } from '../../presets/sizes'
import { useStore } from '../../store'
import { StepFrame, Tip } from './StepFrame'

const STORES = ['App Store', 'Google Play'] as const

/** Store, canvas size and device: the decisions that shape every pixel, so they come first. */
export function TargetStep() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const project = useStore((s) => s.project)
  const targetId = useStore((s) => s.targetId)
  const setTarget = useStore((s) => s.setTarget)
  const updateTarget = useStore((s) => s.updateTarget)
  const current = EXPORT_SIZES.find((s) => s.id === settings.sizeId) ?? EXPORT_SIZES[0]
  // In project mode size and frame belong to the selected target, otherwise to the loose settings.
  const put = (patch: { sizeId?: string; deviceId?: string }) =>
    project ? updateTarget(targetId, patch) : setSettings(patch)

  return (
    <StepFrame
      title="Where is this set going?"
      lead="The store and device family decide the canvas size, and the size is shared by every screenshot in the set. Only the largest device per family is required — the stores downscale for the rest."
    >
      {project && (
        <section className="flex flex-col gap-2">
          <h2 className="label">Target</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {project.set.targets.map((t) => (
              <button
                key={t.id}
                className="option-card"
                data-active={targetId === t.id}
                onClick={() => setTarget(t.id)}
              >
                <span className="text-[13px] font-semibold">
                  {t.id} · {getSize(t.sizeId).store}
                </span>
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>
                  {t.out}
                </span>
              </button>
            ))}
          </div>
          <Tip>
            Every target renders from the same slots and copy. Size and frame below belong to the selected
            target, and only sizes of its store are offered — a target cannot cross over to the other store.
          </Tip>
        </section>
      )}

      {!project && (
        <div className="grid gap-3 sm:grid-cols-2">
          {STORES.map((store) => (
            <button
              key={store}
              className="option-card"
              data-active={current.store === store}
              onClick={() => {
                if (current.store !== store) put({ sizeId: EXPORT_SIZES.find((s) => s.store === store)!.id })
              }}
            >
              <span className="text-[15px] font-semibold">{store}</span>
              <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                {store === 'App Store'
                  ? 'Up to 10 screenshots per device. PNG or JPEG, no alpha channel.'
                  : '2 to 8 phone screenshots, max 2:1 aspect. PNG or JPEG.'}
              </span>
            </button>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="label">Canvas size</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {EXPORT_SIZES.filter((s) => s.store === current.store).map((s) => (
            <button
              key={s.id}
              className="option-card"
              data-active={settings.sizeId === s.id}
              onClick={() => put({ sizeId: s.id })}
            >
              <span className="text-[13px] font-semibold">{s.label}</span>
              <span className="text-[12px] tabular-nums" style={{ color: 'var(--muted)' }}>
                {s.w} × {s.h}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="label">Device frame</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="field"
            style={{ width: 260 }}
            value={settings.deviceId}
            onChange={(e) => put({ deviceId: e.target.value })}
          >
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
          <div className="flex gap-1.5">
            {FRAME_COLORS.map((c) => (
              <button
                key={c.id}
                title={c.label}
                className="swatch"
                style={{ width: 28, background: `linear-gradient(140deg, ${c.edge}, ${c.body})` }}
                data-active={settings.frameColorId === c.id}
                onClick={() => setSettings({ frameColorId: c.id })}
              />
            ))}
          </div>
        </div>
        <Tip>
          Frames are drawn, not photos, so any device works with any store size. Match the frame to the store:
          an iPhone frame on Google Play looks like a port.
        </Tip>
      </section>
    </StepFrame>
  )
}
