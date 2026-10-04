import { useState } from 'react'
import { GRADIENT_PRESETS, SOLID_PRESETS } from '../../presets/backgrounds'
import { PALETTES } from '../../presets/palettes'
import { FINISH_KINDS } from '../../render/finishes'
import type { Background, FinishKind, PaletteColors } from '../../types'
import { Row } from './Controls'
import { gradientCss, type SectionProps } from './shared'

/** A palette pair as a small swatch: its background, with a textColor dot and an accent dot. */
function PaletteSwatch({ colors }: { colors: PaletteColors }) {
  const bg = colors.background.kind === 'solid' ? colors.background.color : gradientCss(colors.background)
  return (
    <span
      className="relative inline-block h-8 w-8 shrink-0 rounded-md border"
      style={{ background: bg, borderColor: 'rgba(0,0,0,0.1)' }}
    >
      <span
        className="absolute bottom-1 left-1 h-2 w-2 rounded-full border"
        style={{ background: colors.textColor, borderColor: 'rgba(0,0,0,0.15)' }}
      />
      <span
        className="absolute bottom-1 right-1 h-2 w-2 rounded-full border"
        style={{ background: colors.eyebrowColor ?? colors.textColor, borderColor: 'rgba(0,0,0,0.15)' }}
      />
    </span>
  )
}

/** Background and the optional rounded backdrop card behind the device band. */
export function BackgroundSection({ settings, put }: SectionProps) {
  const [tab, setTab] = useState<'presets' | 'palettes' | 'custom'>('presets')
  const bg = settings.background
  // Switching to Custom on a solid background needs a gradient to start from.
  const custom: Extract<Background, { kind: 'gradient' }> =
    bg.kind === 'gradient' ? bg : { kind: 'gradient', from: '#6366f1', to: '#a855f7', angle: 135 }
  // The colour under an image, and the finish over it, survive a colour change in Custom.
  const layers = { ...(bg.image ? { image: bg.image } : {}), ...(bg.finish ? { finish: bg.finish } : {}) }
  const finishes = bg.finish ?? []

  return (
    <>
      <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
        <button className="seg" data-active={tab === 'presets'} onClick={() => setTab('presets')}>
          Presets
        </button>
        <button className="seg" data-active={tab === 'palettes'} onClick={() => setTab('palettes')}>
          Palettes
        </button>
        <button className="seg" data-active={tab === 'custom'} onClick={() => setTab('custom')}>
          Custom
        </button>
      </div>

      {tab === 'palettes' && (
        <div className="flex flex-col gap-1.5">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              className="option-card"
              style={{ padding: '8px 10px' }}
              onClick={() =>
                put({
                  background: p.colors.background,
                  textColor: p.colors.textColor,
                  eyebrowColor: p.colors.eyebrowColor,
                  highlights: p.colors.highlights,
                  altColors: p.alt,
                })
              }
            >
              <div className="flex items-center gap-2">
                <PaletteSwatch colors={p.colors} />
                <PaletteSwatch colors={p.alt} />
                <span className="text-[12px]" style={{ color: 'var(--ink)' }}>
                  {p.label}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === 'presets' && (
        <>
          <div className="grid grid-cols-8 gap-1.5">
            {SOLID_PRESETS.map((color) => (
              <button
                key={color}
                className="swatch"
                style={{ background: color }}
                data-active={bg.kind === 'solid' && bg.color === color}
                onClick={() => put({ background: { kind: 'solid', color } })}
              />
            ))}
          </div>
          <div className="grid grid-cols-8 gap-1.5">
            {GRADIENT_PRESETS.map((g) => (
              <button
                key={g.from + g.to}
                className="swatch"
                style={{ background: gradientCss(g) }}
                data-active={bg.kind === 'gradient' && bg.from === g.from && bg.to === g.to}
                onClick={() => put({ background: g })}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'custom' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
            <button
              className="seg"
              data-active={bg.kind === 'solid'}
              onClick={() =>
                put({
                  background: {
                    ...layers,
                    kind: 'solid',
                    color: bg.kind === 'solid' ? bg.color : custom.from,
                  },
                })
              }
            >
              Solid
            </button>
            <button
              className="seg"
              data-active={bg.kind === 'gradient'}
              onClick={() => put({ background: { ...custom, ...layers } })}
            >
              Gradient
            </button>
          </div>

          {bg.kind === 'solid' ? (
            <Row label="Color">
              <input
                type="color"
                value={bg.color}
                onChange={(e) => put({ background: { ...layers, kind: 'solid', color: e.target.value } })}
              />
              <input
                className="field"
                value={bg.color}
                onChange={(e) => put({ background: { ...layers, kind: 'solid', color: e.target.value } })}
              />
            </Row>
          ) : (
            <>
              <Row label="From">
                <input
                  type="color"
                  value={bg.from}
                  onChange={(e) => put({ background: { ...bg, from: e.target.value } })}
                />
                <input
                  className="field"
                  value={bg.from}
                  onChange={(e) => put({ background: { ...bg, from: e.target.value } })}
                />
              </Row>
              <Row label="To">
                <input
                  type="color"
                  value={bg.to}
                  onChange={(e) => put({ background: { ...bg, to: e.target.value } })}
                />
                <input
                  className="field"
                  value={bg.to}
                  onChange={(e) => put({ background: { ...bg, to: e.target.value } })}
                />
              </Row>
              <Row label={`${bg.angle}°`}>
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={bg.angle}
                  onChange={(e) => put({ background: { ...bg, angle: Number(e.target.value) } })}
                />
              </Row>
            </>
          )}
        </div>
      )}

      {bg.image && (
        <Row label="Image">
          <span className="min-w-0 flex-1 truncate text-[12px]" title={bg.image.src}>
            {bg.image.src}
          </span>
          <button
            className="seg shrink-0"
            onClick={() => put({ background: { ...bg, image: undefined } as Background })}
          >
            Remove
          </button>
        </Row>
      )}

      <Row label="Finish">
        {finishes.length > 1 ? (
          <span className="flex-1 text-[12px]">{finishes.map((f) => f.kind).join(' + ')}</span>
        ) : (
          <select
            className="field"
            value={finishes[0]?.kind ?? ''}
            onChange={(e) =>
              put({
                background: {
                  ...bg,
                  finish: e.target.value ? [{ kind: e.target.value as FinishKind }] : undefined,
                },
              })
            }
          >
            <option value="">None</option>
            {FINISH_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        )}
        {finishes.length > 0 && (
          <button className="seg shrink-0" onClick={() => put({ background: { ...bg, finish: undefined } })}>
            Off
          </button>
        )}
      </Row>

      {settings.altColors && (
        <Row label="Contrast">
          <div className="flex flex-1 gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
            <button className="seg" data-active={!settings.inverted} onClick={() => put({ inverted: false })}>
              Off
            </button>
            <button className="seg" data-active={settings.inverted} onClick={() => put({ inverted: true })}>
              Contrast tile
            </button>
          </div>
        </Row>
      )}

      <Row label="Backdrop">
        <input
          type="color"
          value={settings.backdropColor ?? '#e8e0d0'}
          onChange={(e) => put({ backdropColor: e.target.value })}
        />
        <input
          className="field"
          value={settings.backdropColor ?? ''}
          placeholder="None"
          onChange={(e) => put({ backdropColor: e.target.value || null })}
        />
        {settings.backdropColor && (
          <button className="seg shrink-0" onClick={() => put({ backdropColor: null })}>
            Off
          </button>
        )}
      </Row>
    </>
  )
}
