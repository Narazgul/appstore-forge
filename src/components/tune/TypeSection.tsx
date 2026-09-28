import { FONTS, getFont } from '../../presets/fonts'
import { Row } from './Controls'
import type { SectionProps } from './shared'

const FALLBACK_HIGHLIGHT = '#ffe27a'

/** Typeface, size, tracking, alignment, and the marker colours `*starred*` words cycle through. */
export function TypeSection({ settings, put }: SectionProps) {
  const setHighlight = (index: number, color: string) => {
    const next = [...settings.highlights]
    while (next.length <= index) next.push(next[0] ?? FALLBACK_HIGHLIGHT)
    next[index] = color
    put({ highlights: next })
  }

  return (
    <>
      <select
        className="field"
        style={{ fontFamily: getFont(settings.fontId).stack }}
        value={settings.fontId}
        onChange={(e) => put({ fontId: e.target.value })}
      >
        {FONTS.map((f) => (
          <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
            {f.label}
          </option>
        ))}
      </select>
      <Row label={`Head ${Math.round(settings.headlineScale * 100)}%`}>
        <input
          type="range"
          min={0.6}
          max={1.8}
          step={0.05}
          value={settings.headlineScale}
          onChange={(e) => put({ headlineScale: Number(e.target.value) })}
        />
      </Row>
      <Row label={`Sub ${Math.round(settings.subheadScale * 100)}%`}>
        <input
          type="range"
          min={0.6}
          max={1.8}
          step={0.05}
          value={settings.subheadScale}
          onChange={(e) => put({ subheadScale: Number(e.target.value) })}
        />
      </Row>
      <Row
        label={`Track ${settings.headlineTracking >= 0 ? '+' : ''}${Math.round(settings.headlineTracking * 100)}`}
      >
        <input
          type="range"
          min={-0.06}
          max={0.06}
          step={0.005}
          value={settings.headlineTracking}
          onChange={(e) => put({ headlineTracking: Number(e.target.value) })}
        />
      </Row>
      <Row label="Align">
        <div className="flex flex-1 gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
          <button
            className="seg"
            data-active={settings.textAlign === 'left'}
            onClick={() => put({ textAlign: 'left' })}
          >
            Left
          </button>
          <button
            className="seg"
            data-active={settings.textAlign === 'center'}
            onClick={() => put({ textAlign: 'center' })}
          >
            Center
          </button>
        </div>
      </Row>
      <Row label="Color">
        <input type="color" value={settings.textColor} onChange={(e) => put({ textColor: e.target.value })} />
        <input
          className="field"
          value={settings.textColor}
          onChange={(e) => put({ textColor: e.target.value })}
        />
      </Row>
      <Row label="Eyebrow color">
        <input
          type="color"
          value={settings.eyebrowColor ?? settings.textColor}
          onChange={(e) => put({ eyebrowColor: e.target.value })}
        />
        <input
          className="field"
          value={settings.eyebrowColor ?? ''}
          placeholder="Same as text"
          onChange={(e) => put({ eyebrowColor: e.target.value || null })}
        />
        {settings.eyebrowColor && (
          <button className="seg shrink-0" onClick={() => put({ eyebrowColor: null })}>
            Same as text
          </button>
        )}
      </Row>
      <Row label="Highlight">
        {[0, 1].map((i) => (
          <input
            key={i}
            type="color"
            title={`Highlight ${i + 1} — *starred* words cycle through these`}
            value={settings.highlights[i] ?? settings.highlights[0] ?? FALLBACK_HIGHLIGHT}
            onChange={(e) => setHighlight(i, e.target.value)}
          />
        ))}
        <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
          for <code>*words*</code>
        </span>
      </Row>
      <Row label="Accent bar">
        <input
          type="color"
          value={settings.accentBar ?? '#000000'}
          onChange={(e) => put({ accentBar: e.target.value })}
        />
        <input
          className="field"
          value={settings.accentBar ?? ''}
          placeholder="None"
          onChange={(e) => put({ accentBar: e.target.value || null })}
        />
        {settings.accentBar && (
          <button className="seg shrink-0" onClick={() => put({ accentBar: null })}>
            None
          </button>
        )}
      </Row>
      <Row label="Subtitle style">
        <div className="flex flex-1 gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
          <button
            className="seg"
            data-active={settings.subheadStyle === 'plain'}
            onClick={() => put({ subheadStyle: 'plain' })}
          >
            Plain
          </button>
          <button
            className="seg"
            data-active={settings.subheadStyle === 'label'}
            onClick={() => put({ subheadStyle: 'label' })}
          >
            Label
          </button>
        </div>
      </Row>
    </>
  )
}
