import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  CHIP_SIZE_RANGE,
  ELEMENT_POSITION_RANGE,
  ELEMENT_ROTATE_LIMIT,
  ELEMENT_WIDTH_RANGE,
} from '../../lib/canvasEdit'
import { DEFAULT_CHIP_SIZE } from '../../project/bridge'
import { EMPTY_GALLERY } from '../../project/store'
import { isSlotChip, isSlotEffect, isSlotShape } from '../../project/types'
import type { SlotChip, SlotElement, SlotShape, SlotSticker } from '../../project/types'
import { useStore } from '../../store'
import { turnsVisibly } from '../../types'
import type { ShapeKind } from '../../types'
import { Row } from './Controls'

const STICKER_DEFAULTS: Pick<Required<SlotSticker>, 'x' | 'y' | 'width' | 'rotate' | 'layer' | 'shadow'> = {
  x: 0.5,
  y: 0.75,
  width: 0.3,
  rotate: 0,
  layer: 'front',
  shadow: false,
}

const SHAPE_DEFAULTS: Pick<Required<SlotShape>, 'x' | 'y' | 'width' | 'rotate' | 'layer' | 'color'> = {
  x: 0.5,
  y: 0.5,
  width: 0.3,
  rotate: 0,
  layer: 'behind',
  color: '#eaf2ff',
}

const SHAPE_KIND_OPTIONS: { kind: ShapeKind; label: string }[] = [
  { kind: 'circle', label: 'Add circle' },
  { kind: 'ring', label: 'Add ring' },
  { kind: 'blob', label: 'Add blob' },
]
const DEFAULT_RING_STROKE = 0.12
const DEFAULT_BLOB_SEED = 1

/** No `color`/`textColor` here — a fresh chip leaves them unset, so it starts out inheriting the
 *  slot's own highlight and text colour (see `ChipElement` in `types.ts`). */
const CHIP_DEFAULTS: Pick<SlotChip, 'x' | 'y' | 'width' | 'rotate' | 'layer' | 'shadow'> = {
  x: 0.5,
  y: 0.25,
  width: 0.5,
  rotate: 0,
  layer: 'front',
  shadow: false,
}

/** An element id has to be unique within the slot; the artwork name (or "circle") is the obvious start. */
function freeElementId(taken: string[], base: string): string {
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`
}

/**
 * Free-standing elements — stickers and deco shapes — on the selected slot. Project mode only —
 * an element is written straight into `set.slots[i].elements`, not an override, so it has no
 * "All screens" scope.
 */
export function StickersSection({ slotId }: { slotId: string }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const localeId = useStore((s) => s.localeId)
  const projectStore = useStore((s) => s.projectStore)
  const setSlotElements = useStore((s) => s.setSlotElements)
  const gallery = useStore((s) => s.gallery[s.localeId] ?? EMPTY_GALLERY)
  const elements = useStore(
    useShallow((s) => s.project?.set.slots.find((slot) => slot.id === slotId)?.elements ?? []),
  )

  if (!projectStore) return null

  const write = (next: SlotElement[]) => void setSlotElements(slotId, next)
  const update = (id: string, patch: Partial<SlotSticker> & Partial<SlotShape> & Partial<SlotChip>) =>
    write(elements.map((el) => (el.id === id ? ({ ...el, ...patch } as SlotElement) : el)))
  const move = (index: number, delta: number) => {
    const to = index + delta
    if (to < 0 || to >= elements.length) return
    const next = [...elements]
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    write(next)
  }
  const remove = (id: string) => write(elements.filter((el) => el.id !== id))
  const addSticker = (artwork: string) => {
    const id = freeElementId(
      elements.map((el) => el.id),
      artwork,
    )
    write([...elements, { id, artwork, ...STICKER_DEFAULTS }])
    setPickerOpen(false)
  }
  const addShape = (kind: ShapeKind) => {
    const id = freeElementId(
      elements.map((el) => el.id),
      kind,
    )
    const extra =
      kind === 'ring' ? { stroke: DEFAULT_RING_STROKE } : kind === 'blob' ? { seed: DEFAULT_BLOB_SEED } : {}
    write([...elements, { id, shape: kind, ...SHAPE_DEFAULTS, ...extra }])
  }
  const addChip = () => {
    const id = freeElementId(
      elements.map((el) => el.id),
      'chip',
    )
    write([...elements, { id, chip: true, ...CHIP_DEFAULTS }])
  }

  return (
    <>
      {elements.map((el, index) =>
        isSlotEffect(el) ? (
          <div
            key={el.id}
            className="flex items-center gap-2 rounded-lg p-2"
            style={{ border: '1px solid var(--line)' }}
          >
            <span className="flex-1 truncate text-[12px]" title={el.id}>
              Effect {el.effect}: {[el.node ?? el.id].flat().join(', ')}
            </span>
            <button className="seg" disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </button>
            <button className="seg" disabled={index === elements.length - 1} onClick={() => move(index, 1)}>
              ↓
            </button>
            <button className="seg" onClick={() => remove(el.id)}>
              Remove
            </button>
          </div>
        ) : (
          <div
            key={el.id}
            className="flex flex-col gap-2 rounded-lg p-2"
            style={{ border: '1px solid var(--line)' }}
          >
            {isSlotShape(el) ? (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={el.color}
                  onChange={(e) => update(el.id, { color: e.target.value })}
                  style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'none' }}
                />
                <input
                  className="field flex-1"
                  value={el.color}
                  onChange={(e) => update(el.id, { color: e.target.value })}
                />
                <button className="seg" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button
                  className="seg"
                  disabled={index === elements.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button className="seg" onClick={() => remove(el.id)}>
                  Remove
                </button>
              </div>
            ) : isSlotChip(el) ? (
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full"
                  style={{ width: 14, height: 14, background: el.color ?? 'var(--accent)' }}
                />
                <span className="flex-1 truncate text-[12px]" title={el.id}>
                  Chip: {el.id}
                </span>
                <button className="seg" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button
                  className="seg"
                  disabled={index === elements.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button className="seg" onClick={() => remove(el.id)}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <img
                  src={projectStore.artworkUrl?.(localeId, el.artwork)}
                  alt=""
                  className="rounded"
                  style={{ width: 28, height: 28, objectFit: 'contain', background: 'var(--shell)' }}
                />
                <span className="flex-1 truncate text-[12px]" title={el.artwork}>
                  {el.artwork}
                </span>
                <button className="seg" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button
                  className="seg"
                  disabled={index === elements.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button className="seg" onClick={() => remove(el.id)}>
                  Remove
                </button>
              </div>
            )}
            <Row label={`X ${Math.round(el.x * 100)}%`}>
              <input
                type="range"
                min={ELEMENT_POSITION_RANGE.min}
                max={ELEMENT_POSITION_RANGE.max}
                step={0.01}
                value={el.x}
                onChange={(e) => update(el.id, { x: Number(e.target.value) })}
              />
            </Row>
            <Row label={`Y ${Math.round(el.y * 100)}%`}>
              <input
                type="range"
                min={ELEMENT_POSITION_RANGE.min}
                max={ELEMENT_POSITION_RANGE.max}
                step={0.01}
                value={el.y}
                onChange={(e) => update(el.id, { y: Number(e.target.value) })}
              />
            </Row>
            <Row label={`${isSlotChip(el) ? 'Max width' : 'Width'} ${Math.round(el.width * 100)}%`}>
              <input
                type="range"
                min={ELEMENT_WIDTH_RANGE.min}
                max={ELEMENT_WIDTH_RANGE.max}
                step={0.01}
                value={el.width}
                onChange={(e) => update(el.id, { width: Number(e.target.value) })}
              />
            </Row>
            {isSlotShape(el) && el.shape === 'ring' && (
              <Row label={`Stroke ${Math.round((el.stroke ?? DEFAULT_RING_STROKE) * 100)}%`}>
                <input
                  type="range"
                  min={0.02}
                  max={0.5}
                  step={0.01}
                  value={el.stroke ?? DEFAULT_RING_STROKE}
                  onChange={(e) => update(el.id, { stroke: Number(e.target.value) })}
                />
              </Row>
            )}
            {isSlotShape(el) && el.shape === 'blob' && (
              <Row label={`Seed ${el.seed ?? DEFAULT_BLOB_SEED}`}>
                <button
                  className="seg"
                  onClick={() => update(el.id, { seed: Math.floor(Math.random() * 100000) })}
                >
                  Shuffle
                </button>
              </Row>
            )}
            {isSlotChip(el) && (
              <>
                <Row label={`Text size ${Math.round((el.size ?? DEFAULT_CHIP_SIZE) * 1000) / 10}%`}>
                  <input
                    type="range"
                    min={CHIP_SIZE_RANGE.min}
                    max={CHIP_SIZE_RANGE.max}
                    step={0.001}
                    value={el.size ?? DEFAULT_CHIP_SIZE}
                    onChange={(e) => update(el.id, { size: Number(e.target.value) })}
                  />
                </Row>
                <Row label="Fill">
                  <input
                    type="color"
                    value={el.color ?? '#ffffff'}
                    onChange={(e) => update(el.id, { color: e.target.value })}
                    style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'none' }}
                  />
                  <input
                    className="field flex-1"
                    value={el.color ?? ''}
                    placeholder="Default (first highlight)"
                    onChange={(e) => update(el.id, { color: e.target.value || undefined })}
                  />
                </Row>
                <Row label="Text">
                  <input
                    type="color"
                    value={el.textColor ?? '#111114'}
                    onChange={(e) => update(el.id, { textColor: e.target.value })}
                    style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'none' }}
                  />
                  <input
                    className="field flex-1"
                    value={el.textColor ?? ''}
                    placeholder="Default (text colour)"
                    onChange={(e) => update(el.id, { textColor: e.target.value || undefined })}
                  />
                </Row>
              </>
            )}
            {turnsVisibly(el) && (
              <Row label={`Rotate ${el.rotate ?? 0}°`}>
                <input
                  type="range"
                  min={-ELEMENT_ROTATE_LIMIT}
                  max={ELEMENT_ROTATE_LIMIT}
                  value={el.rotate ?? 0}
                  onChange={(e) => update(el.id, { rotate: Number(e.target.value) })}
                />
              </Row>
            )}
            <Row label="Layer">
              <div className="flex flex-1 gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
                <button
                  className="seg"
                  data-active={(el.layer ?? 'front') === 'behind'}
                  onClick={() => update(el.id, { layer: 'behind' })}
                >
                  Behind
                </button>
                <button
                  className="seg"
                  data-active={(el.layer ?? 'front') === 'front'}
                  onClick={() => update(el.id, { layer: 'front' })}
                >
                  Front
                </button>
              </div>
            </Row>
            {!isSlotShape(el) && (
              <Row label="Shadow">
                <div className="flex flex-1 gap-1 rounded-lg p-1" style={{ background: 'var(--shell)' }}>
                  <button
                    className="seg"
                    data-active={!(el.shadow ?? false)}
                    onClick={() => update(el.id, { shadow: false })}
                  >
                    Off
                  </button>
                  <button
                    className="seg"
                    data-active={el.shadow ?? false}
                    onClick={() => update(el.id, { shadow: true })}
                  >
                    On
                  </button>
                </div>
              </Row>
            )}
          </div>
        ),
      )}

      {pickerOpen ? (
        gallery.artwork.length ? (
          <div className="pick-grid">
            {gallery.artwork.map((name) => (
              <button key={name} className="pick-tile" onClick={() => addSticker(name)} title={name}>
                <img src={projectStore.artworkUrl?.(localeId, name)} alt="" loading="lazy" />
                <span className="pick-caption">{name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            No artwork images in the project yet.
          </p>
        )
      ) : null}
      <div className="flex gap-3">
        <button className="linkish" onClick={() => setPickerOpen(!pickerOpen)}>
          {pickerOpen ? 'Cancel' : 'Add sticker'}
        </button>
        {SHAPE_KIND_OPTIONS.map((o) => (
          <button key={o.kind} className="linkish" onClick={() => addShape(o.kind)}>
            {o.label}
          </button>
        ))}
        <button className="linkish" onClick={addChip}>
          Add chip
        </button>
      </div>
    </>
  )
}
