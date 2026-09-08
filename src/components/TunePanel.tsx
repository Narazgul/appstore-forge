import { SECTION_KEYS, effectiveSettings } from '../lib/settings'
import { useStore } from '../store'
import type { OverridableKey, ScreenOverrides, Settings } from '../types'
import { AdjustSection } from './tune/AdjustSection'
import { BackgroundSection } from './tune/BackgroundSection'
import { Section } from './tune/Controls'
import { DeviceSection } from './tune/DeviceSection'
import { LayoutSection } from './tune/LayoutSection'
import { TypeSection } from './tune/TypeSection'

/**
 * Fine-tune controls. Reads the resolved value for the selected screen (or the global set) and
 * writes back to that scope; each section shows a dot when the selected screen overrides it.
 * The sections themselves live in `./tune` — this file owns only the scope switch.
 */
export function TunePanel() {
  const global = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const screens = useStore((s) => s.screens)
  const selectedId = useStore((s) => s.selectedId)
  const selectScreen = useStore((s) => s.selectScreen)
  const setOverride = useStore((s) => s.setOverride)
  const clearOverrides = useStore((s) => s.clearOverrides)
  const clearAllOverrides = useStore((s) => s.clearAllOverrides)

  const selected = screens.find((s) => s.id === selectedId) ?? null
  const selectedIndex = screens.findIndex((s) => s.id === selectedId)
  const overrideCount = screens.filter((s) => Object.keys(s.overrides).length > 0).length

  // Controls read the resolved value and write to whichever scope is active.
  const settings: Settings = selected ? effectiveSettings(selected, global) : global
  const put = (patch: ScreenOverrides) => (selected ? setOverride(selected.id, patch) : setSettings(patch))
  const sectionOverridden = (key: string) =>
    !!selected && SECTION_KEYS[key]?.some((k) => selected.overrides[k] !== undefined)
  const resetSection = (key: string) =>
    selected && clearOverrides(selected.id, SECTION_KEYS[key] as OverridableKey[])

  /** Wires a section's override dot and its "reset to all screens" link. */
  const scope = (key: string) => ({
    overridden: sectionOverridden(key),
    onReset: () => resetSection(key),
  })

  return (
    <aside
      className="sticky top-8 flex max-h-[calc(100vh-150px)] w-[300px] shrink-0 flex-col overflow-y-auto rounded-2xl border"
      style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
    >
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
          <button className="seg" data-active={!selected} onClick={() => selectScreen(null)}>
            All screens
          </button>
          <button className="seg" data-active={!!selected} disabled={!selected}>
            {selected ? `Screen ${selectedIndex + 1}` : 'No selection'}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
          {selected
            ? 'Changes apply to this screen only. Click the canvas background to go back to all screens.'
            : overrideCount > 0
              ? `Editing every screen. ${overrideCount} screen${overrideCount === 1 ? ' has' : 's have'} their own settings and will keep them.`
              : 'Click a screenshot to give it its own settings.'}
        </p>
        {!selected && overrideCount > 0 && (
          <button className="linkish mt-1.5" onClick={clearAllOverrides}>
            Reset all screens to these settings
          </button>
        )}
      </div>

      <Section id="background" title="Background" {...scope('background')}>
        <BackgroundSection settings={settings} put={put} />
      </Section>

      <Section id="device" title="Device frame" {...scope('device')}>
        <DeviceSection settings={settings} put={put} />
      </Section>

      <Section id="layout" title="Layout" {...scope('layout')}>
        <LayoutSection settings={settings} put={put} />
      </Section>

      <Section id="type" title="Type" defaultOpen={false} {...scope('type')}>
        <TypeSection settings={settings} put={put} />
      </Section>

      <Section id="adjust" title="Adjust" defaultOpen={false} {...scope('adjust')}>
        <AdjustSection settings={settings} put={put} />
      </Section>
    </aside>
  )
}
