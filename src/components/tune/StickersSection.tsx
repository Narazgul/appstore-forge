import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EMPTY_GALLERY } from '../../project/store'
import { isSlotShape } from '../../project/types'
import type { SlotElement, SlotShape, SlotSticker } from '../../project/types'
import { useStore } from '../../store'
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
  const update = (id: string, patch: Partial<SlotSticker> & Partial<SlotShape>) =>
    write(elements.map((el) => (el.id === id ? { ...el, ...patch } : el)))
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
  const addShape = () => {
    const id = freeElementId(
      elements.map((el) => el.id),
      'circle',
    )
    write([...elements, { id, shape: 'circle', ...SHAPE_DEFAULTS }])
  }

  return (
    <>
      {elements.map((el, index) => (
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
              <button className="seg" disabled={index === elements.length - 1} onClick={() => move(index, 1)}>
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
              <button className="seg" disabled={index === elements.length - 1} onClick={() => move(index, 1)}>
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
              min={-0.2}
              max={1.2}
              step={0.01}
              value={el.x}
              onChange={(e) => update(el.id, { x: Number(e.target.value) })}
            />
          </Row>
          <Row label={`Y ${Math.round(el.y * 100)}%`}>
            <input
              type="range"
              min={-0.2}
              max={1.2}
              step={0.01}
              value={el.y}
              onChange={(e) => update(el.id, { y: Number(e.target.value) })}
            />
          </Row>
          <Row label={`Width ${Math.round(el.width * 100)}%`}>
            <input
              type="range"
              min={0.05}
              max={1.5}
              step={0.01}
              value={el.width}
              onChange={(e) => update(el.id, { width: Number(e.target.value) })}
            />
          </Row>
          {!isSlotShape(el) && (
            <Row label={`Rotate ${el.rotate ?? 0}°`}>
              <input
                type="range"
                min={-45}
                max={45}
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
      ))}

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
        <button className="linkish" onClick={addShape}>
          Add circle
        </button>
      </div>
    </>
  )
}
