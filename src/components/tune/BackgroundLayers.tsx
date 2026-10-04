import { useEffect, useState } from 'react'
import { editorBackdropContrast } from '../../ai/editorHost'
import { AA_LARGE_TEXT } from '../../lib/contrast'
import { imageAverageColor } from '../../lib/averageColor'
import type { BackgroundChoice } from '../../project/store'
import { backgroundImageSrcs } from '../../project/types'
import { FINISH_DEFAULTS, FINISH_KINDS, IMAGE_DEFAULTS } from '../../render/finishes'
import { useStore } from '../../store'
import type { Background, BackgroundImage, Finish, FinishKind } from '../../types'
import { Row } from './Controls'
import type { SectionProps } from './shared'

type Range = { min: number; max: number; step: number }

type Control =
  | ({ key: string; label: string; kind: 'range' } & Range)
  | { key: string; label: string; kind: 'color'; index?: number }
  | { key: string; label: string; kind: 'toggle' }
  | { key: string; label: string; kind: 'choice'; options: string[] }

/** The limits `validateBackground` enforces, so a slider can never write a value `forge check` refuses. */
const IMAGE_CONTROLS: ({ key: Exclude<keyof BackgroundImage, 'src'>; label: string } & Range)[] = [
  { key: 'focusX', label: 'Focus X', min: 0, max: 1, step: 0.01 },
  { key: 'focusY', label: 'Focus Y', min: 0, max: 1, step: 0.01 },
  { key: 'zoom', label: 'Zoom', min: 1, max: 4, step: 0.05 },
  { key: 'blur', label: 'Blur', min: 0, max: 0.1, step: 0.002 },
  { key: 'brightness', label: 'Bright', min: 0, max: 2, step: 0.02 },
]

const ANGLE = { min: -180, max: 180, step: 1 }

const FINISH_CONTROLS: Record<FinishKind, Control[]> = {
  grain: [
    { key: 'amount', label: 'Amount', kind: 'range', min: 0, max: 0.5, step: 0.01 },
    { key: 'size', label: 'Size', kind: 'range', min: 0.0003, max: 0.02, step: 0.0001 },
    { key: 'mono', label: 'Mono', kind: 'toggle' },
  ],
  motion: [
    { key: 'length', label: 'Length', kind: 'range', min: 0.002, max: 0.3, step: 0.002 },
    { key: 'angle', label: 'Angle', kind: 'range', ...ANGLE },
  ],
  halftone: [
    { key: 'cell', label: 'Cell', kind: 'range', min: 0.003, max: 0.08, step: 0.001 },
    { key: 'angle', label: 'Angle', kind: 'range', ...ANGLE },
    { key: 'paper', label: 'Paper', kind: 'color' },
  ],
  newsprint: [
    { key: 'cell', label: 'Cell', kind: 'range', min: 0.003, max: 0.08, step: 0.001 },
    { key: 'angle', label: 'Angle', kind: 'range', ...ANGLE },
    { key: 'ink', label: 'Ink', kind: 'color' },
    { key: 'paper', label: 'Paper', kind: 'color' },
  ],
  dither: [
    { key: 'pixel', label: 'Pixel', kind: 'range', min: 0.0005, max: 0.02, step: 0.0005 },
    { key: 'dark', label: 'Dark', kind: 'color' },
    { key: 'light', label: 'Light', kind: 'color' },
  ],
  riso: [
    { key: 'inks', label: 'Ink 1', kind: 'color', index: 0 },
    { key: 'inks', label: 'Ink 2', kind: 'color', index: 1 },
    { key: 'paper', label: 'Paper', kind: 'color' },
    { key: 'offset', label: 'Offset', kind: 'range', min: 0, max: 0.05, step: 0.001 },
    { key: 'grain', label: 'Grain', kind: 'range', min: 0, max: 0.5, step: 0.01 },
  ],
  duotone: [
    { key: 'dark', label: 'Dark', kind: 'color' },
    { key: 'light', label: 'Light', kind: 'color' },
  ],
  reeded: [
    { key: 'rib', label: 'Rib', kind: 'range', min: 0.005, max: 0.2, step: 0.005 },
    { key: 'strength', label: 'Strength', kind: 'range', min: 0, max: 1, step: 0.05 },
    { key: 'direction', label: 'Direction', kind: 'choice', options: ['vertical', 'horizontal'] },
  ],
}

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i

/** A colour input takes #rrggbb only; the files may also hold #rgb. */
const longHex = (hex: string) => hex.replace(SHORT_HEX, '#$1$1$2$2$3$3')

const fileName = (src: string) => src.slice(src.lastIndexOf('/') + 1)

const decimals = (step: number) => Math.max(0, -Math.floor(Math.log10(step)))

/** Every picture the backend offers plus the ones the set already draws, each once. */
function useBackgroundChoices(): BackgroundChoice[] {
  const projectStore = useStore((s) => s.projectStore)
  const project = useStore((s) => s.project)
  const offered = projectStore?.backgroundGallery?.() ?? []
  const used = project ? backgroundImageSrcs(project.set) : []
  const seen = new Set(offered.map((c) => c.src))
  return [...offered, ...used.filter((src) => !seen.has(src)).map((src) => ({ src }))]
}

/** Below this the render stops (`validateProject`); the hint says so before the CLI does. */
function BackdropContrastHint() {
  const project = useStore((s) => s.project)
  const images = useStore((s) => s.images)
  const selectedId = useStore((s) => s.selectedId)
  const [report, setReport] = useState<{ slotId: string; ratio: number } | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setReport(editorBackdropContrast(useStore.getState(), selectedId ? [selectedId] : undefined))
    }, 250)
    return () => clearTimeout(timer)
  }, [project, images, selectedId])

  if (!report) return null
  const low = report.ratio < AA_LARGE_TEXT
  return (
    <p
      className="text-[11px] leading-snug"
      data-control="backdrop-contrast"
      style={{ color: low ? 'var(--warn)' : 'var(--muted)' }}
    >
      Headline on the picture: {report.ratio.toFixed(1)}:1
      {low ? ` in tile ${report.slotId}, below ${AA_LARGE_TEXT}:1 forge will not render it` : ''}
    </p>
  )
}

/**
 * The picture under the background colour and its framing. Picking one makes the background solid in
 * the picture's mean colour, the fallback the contrast checks use when the picture itself is missing.
 */
export function BackgroundImageControls({ settings, put }: SectionProps) {
  const projectStore = useStore((s) => s.projectStore)
  const loadBackgroundImage = useStore((s) => s.loadBackgroundImage)
  const choices = useBackgroundChoices()
  const bg = settings.background
  const backgroundUrl = projectStore?.backgroundUrl?.bind(projectStore)
  if (!backgroundUrl) return null

  const pick = async (choice: BackgroundChoice) => {
    const img = await loadBackgroundImage(choice.src)
    const color = choice.average ?? (img ? imageAverageColor(img) : bg.kind === 'solid' ? bg.color : bg.from)
    put({
      background: {
        kind: 'solid',
        color,
        image: { src: choice.src },
        ...(bg.finish ? { finish: bg.finish } : {}),
      },
    })
  }
  const remove = () => put({ background: { ...bg, image: undefined } as Background })
  const setField = (key: Exclude<keyof BackgroundImage, 'src'>, value: number) =>
    bg.image && put({ background: { ...bg, image: { ...bg.image, [key]: value } } })

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
          Image
        </span>
        {bg.image && (
          <button className="linkish" onClick={remove}>
            Remove image
          </button>
        )}
      </div>
      {choices.length === 0 ? (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
          No pictures in hintergruende/ yet — add one with forge bg fetch.
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5" data-control="background-images">
          {choices.map((choice) => (
            <button
              key={choice.src}
              className="swatch"
              title={fileName(choice.src)}
              data-src={choice.src}
              data-active={bg.image?.src === choice.src}
              style={{
                height: 44,
                background: `${choice.average ?? '#888'} center / cover no-repeat url("${backgroundUrl(choice.src)}")`,
              }}
              onClick={() => void pick(choice)}
            />
          ))}
        </div>
      )}
      {bg.image && <BackdropContrastHint />}
      {bg.image &&
        IMAGE_CONTROLS.map(({ key, label, min, max, step }) => {
          const value = bg.image![key] ?? IMAGE_DEFAULTS[key]
          return (
            <Row key={key} label={label}>
              <input
                type="range"
                data-control={`image-${key}`}
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => setField(key, Number(e.target.value))}
              />
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums">
                {value.toFixed(decimals(step))}
              </span>
            </Row>
          )
        })}
    </>
  )
}

/** The surface over the background. One finish gets its controls; a stack of several, which only
 *  the files can write, is shown by name and can be switched off whole. */
export function FinishControls({ settings, put }: SectionProps) {
  const bg = settings.background
  const finishes = bg.finish ?? []
  const finish = finishes.length === 1 ? finishes[0] : null
  const setFinish = (next: Finish | null) => put({ background: { ...bg, finish: next ? [next] : undefined } })
  const fieldOf = (control: Control): unknown => {
    const own = (finish as Record<string, unknown> | null)?.[control.key]
    const fallback = (FINISH_DEFAULTS[finish!.kind] as Record<string, unknown>)[control.key]
    const value = own ?? fallback
    return control.kind === 'color' && control.index !== undefined
      ? (value as string[])[control.index]
      : value
  }
  const setField = (control: Control, value: unknown) => {
    if (!finish) return
    if (control.kind === 'color' && control.index !== undefined) {
      const pair = [...((fieldOf({ ...control, index: undefined }) as string[]) ?? [])]
      pair[control.index] = value as string
      return setFinish({ ...finish, [control.key]: pair } as Finish)
    }
    setFinish({ ...finish, [control.key]: value } as Finish)
  }

  return (
    <>
      <Row label="Finish">
        {finishes.length > 1 ? (
          <span className="flex-1 text-[12px]">{finishes.map((f) => f.kind).join(' + ')}</span>
        ) : (
          <select
            className="field"
            data-control="finish"
            value={finish?.kind ?? ''}
            onChange={(e) => setFinish(e.target.value ? { kind: e.target.value as FinishKind } : null)}
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
          <button className="seg shrink-0" onClick={() => setFinish(null)}>
            Off
          </button>
        )}
      </Row>
      {finish &&
        FINISH_CONTROLS[finish.kind].map((control) => {
          const id = `finish-${control.key}${control.kind === 'color' && control.index !== undefined ? `-${control.index}` : ''}`
          const value = fieldOf(control)
          if (control.kind === 'range')
            return (
              <Row key={id} label={control.label}>
                <input
                  type="range"
                  data-control={id}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={value as number}
                  onChange={(e) => setField(control, Number(e.target.value))}
                />
                <span className="w-12 shrink-0 text-right text-[11px] tabular-nums">
                  {(value as number).toFixed(decimals(control.step))}
                </span>
              </Row>
            )
          if (control.kind === 'color')
            return (
              <Row key={id} label={control.label}>
                <input
                  type="color"
                  data-control={id}
                  value={longHex(value as string)}
                  onChange={(e) => setField(control, e.target.value)}
                />
                <span className="flex-1 text-[11px] tabular-nums">{value as string}</span>
              </Row>
            )
          if (control.kind === 'toggle')
            return (
              <Row key={id} label={control.label}>
                <div className="flex flex-1 gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
                  <button
                    className="seg"
                    data-active={value === true}
                    onClick={() => setField(control, true)}
                  >
                    On
                  </button>
                  <button
                    className="seg"
                    data-active={value === false}
                    onClick={() => setField(control, false)}
                  >
                    Off
                  </button>
                </div>
              </Row>
            )
          return (
            <Row key={id} label={control.label}>
              <select
                className="field"
                data-control={id}
                value={value as string}
                onChange={(e) => setField(control, e.target.value)}
              >
                {control.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Row>
          )
        })}
    </>
  )
}
