import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GestureSession,
  clientToScene,
  formatOffset,
  handlePositions,
  hitTest,
  nudgeEdit,
  pointInBox,
  resolveOverrides,
  type CanvasEdit,
  type GestureMode,
  type Guides,
  type Pt,
} from '../lib/canvasEdit'
import { isEditableTarget, isRedoShortcut, isUndoShortcut } from '../lib/keyboard'
import { effectiveSettings } from '../lib/settings'
import type { SceneSources } from '../render/scene'
import { orientedCorners, sceneTargets, targetKey, type SceneTarget } from '../render/targets'
import { useStore } from '../store'
import { isPlacedElement } from '../types'
import type { Screen, Settings } from '../types'

/** Side of a square handle, and how close a press must land to take it, in CSS pixels. */
const HANDLE = 9
const HANDLE_REACH = 8
/** How far the rotate handle sits beyond the frame's top edge. */
const ARM = 20
/** Handles are kept this far inside the canvas, so an off-canvas corner still has one. */
const HANDLE_INSET = 6
/** The interactive surface reaches this far past the canvas on every side, for the handles. */
const OVERHANG = 12
/** A click this close outside a part still takes it — a thin chip is hard to hit otherwise. */
const HIT_PAD = 2

const GUIDE_COLOR = '#ff2d95'

/** Unique per gesture, so two quick drags never merge into one undo step (`COALESCE_MS`). */
let gestureSeq = 0

const ARROWS: Record<string, Pt> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

function readout(edit: CanvasEdit): string {
  if (edit.kind === 'element') {
    const f = edit.fields
    if (f.rotate !== undefined) return `${f.rotate}°`
    if (f.width !== undefined) return `width ${(f.width * 100).toFixed(1)} %`
    return `x ${((f.x ?? 0) * 100).toFixed(1)} % · y ${((f.y ?? 0) * 100).toFixed(1)} %`
  }
  const f = edit.fields
  if (f.tilt !== undefined) return `${f.tilt}°`
  if (f.deviceScale !== undefined) return `scale ${f.deviceScale.toFixed(2)}`
  const off = f.deviceOffset ?? f.textOffset
  return off ? formatOffset(off) : ''
}

/**
 * Direct manipulation on a tile's preview: click a sticker, shape, chip, the device arrangement or
 * the copy to select it; drag to move, pull the corner handle to scale, the round handle to turn.
 * Frames, handles and snap guides are DOM on top of the canvas — never drawn by `renderScene`, so
 * the export can never contain them. Mid-gesture the preview draws the edit through `onEdit`
 * without touching the store; letting go writes it once (`applyCanvasEdit`: one undo step, one
 * scheduled save), Escape throws it away.
 */
export function CanvasEditor({
  screen,
  shown,
  settings,
  sources,
  width,
  height,
  span,
  onEdit,
}: {
  /** the tile as stored */
  screen: Screen
  /** the tile as drawn right now — `screen` with the live edit laid over it */
  shown: Screen
  /** the set-wide settings, what an override is judged against */
  settings: Settings
  sources: SceneSources
  width: number
  height: number
  span: number
  onEdit: (edit: CanvasEdit | null) => void
}) {
  const selectedId = useStore((s) => s.selectedId)
  const selectScreen = useStore((s) => s.selectScreen)
  const applyCanvasEdit = useStore((s) => s.applyCanvasEdit)
  const active = selectedId === screen.id
  const [picked, setPicked] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [live, setLive] = useState<{ guides: Guides; text: string } | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const gesture = useRef<GestureSession | null>(null)
  const fullW = width * span

  const measure = useMemo(
    () => (typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')),
    [],
  )
  const targets = useMemo(
    () => (measure ? sceneTargets(measure, width, height, shown, settings, sources) : []),
    [measure, width, height, shown, settings, sources],
  )
  const selectedKey = active ? picked : null
  const selected = targets.find((t) => targetKey(t) === selectedKey) ?? null
  const handles = selected ? handlePositions(selected, fullW, height, ARM, HANDLE_INSET) : null

  const toScene = (e: { clientX: number; clientY: number }): Pt => {
    const rect = surface.current!.getBoundingClientRect()
    return clientToScene(
      { x: e.clientX, y: e.clientY },
      {
        left: rect.left + OVERHANG,
        top: rect.top + OVERHANG,
        width: rect.width - OVERHANG * 2,
        height: rect.height - OVERHANG * 2,
      },
      fullW,
      height,
    )
  }
  const onCanvas = (p: Pt) => p.x >= 0 && p.y >= 0 && p.x <= fullW && p.y <= height
  const near = (p: Pt, q: Pt | undefined) => !!q && Math.hypot(p.x - q.x, p.y - q.y) <= HANDLE_REACH

  /** What a press at `p` would grab, and how: a handle of the selection first, then the topmost
   *  part under the pointer, then the selection's own frame (the gap between two devices). */
  const grab = (p: Pt): { target: SceneTarget; mode: GestureMode } | null => {
    if (selected && handles) {
      if (near(p, handles.scale)) return { target: selected, mode: 'scale' }
      if (near(p, handles.rotate)) return { target: selected, mode: 'rotate' }
    }
    if (!onCanvas(p)) return null
    const hit = hitTest(p, targets, HIT_PAD)
    if (hit) return { target: hit, mode: 'move' }
    if (selected && pointInBox(p, selected.frame)) return { target: selected, mode: 'move' }
    return null
  }

  const finish = (commit: boolean) => {
    const cur = gesture.current
    gesture.current = null
    if (!cur) return
    if (surface.current?.hasPointerCapture(cur.pointerId))
      surface.current.releasePointerCapture(cur.pointerId)
    setLive(null)
    if (!commit) cur.cancel()
    const edit = cur.end(settings)
    if (edit) applyCanvasEdit(screen.id, edit, `gesture:${++gestureSeq}`)
    onEdit(null)
  }

  // The window listener reads the latest render through this ref, so it registers only once.
  const latest = useRef({ active, selected, screen, settings, span, finish, applyCanvasEdit })
  useEffect(() => {
    latest.current = { active, selected, screen, settings, span, finish, applyCanvasEdit }
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const now = latest.current
      if (gesture.current) {
        // Mid-gesture, Escape and Undo both mean "not this": the tile goes back to where the
        // gesture found it, and the undo stack is left alone.
        if (e.key === 'Escape' || isUndoShortcut(e) || isRedoShortcut(e)) {
          e.preventDefault()
          e.stopImmediatePropagation()
          now.finish(false)
        }
        return
      }
      if (!now.active || !now.selected || isEditableTarget(e.target)) return
      if (e.key === 'Escape') {
        setPicked(null)
        return
      }
      const dir = ARROWS[e.key]
      if (!dir) return
      e.preventDefault()
      const t = now.selected
      const effective = effectiveSettings(now.screen, now.settings)
      const element =
        t.kind === 'element'
          ? now.screen.elements?.filter(isPlacedElement).find((el) => el.id === t.id)
          : undefined
      if (t.kind === 'element' && !element) return
      const edit = nudgeEdit(t, effective, element, dir, e.shiftKey, { span: now.span })
      const resolved: CanvasEdit =
        edit.kind === 'settings'
          ? { kind: 'settings', fields: resolveOverrides(edit.fields, now.settings) }
          : edit
      // A held arrow key is one step, like a slider drag.
      now.applyCanvasEdit(now.screen.id, resolved, `nudge:${now.screen.id}:${targetKey(t)}`)
    }
    // Capture phase: it has to run before the app's own Undo shortcut to swallow it mid-gesture.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || gesture.current) return
    const p = toScene(e)
    const grabbed = grab(p)
    if (!grabbed) {
      setPicked(null)
      return
    }
    e.preventDefault()
    // Focus leaves any copy field, so the arrow keys move the selection instead of the caret.
    surface.current!.focus({ preventScroll: true })
    surface.current!.setPointerCapture(e.pointerId)
    selectScreen(screen.id)
    setPicked(targetKey(grabbed.target))
    const t = grabbed.target
    gesture.current = new GestureSession(
      {
        mode: grabbed.mode,
        target: t,
        origin: p,
        effective: effectiveSettings(screen, settings),
        element:
          t.kind === 'element'
            ? screen.elements?.filter(isPlacedElement).find((el) => el.id === t.id)
            : undefined,
      },
      e.pointerId,
      { x: e.clientX, y: e.clientY },
    )
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const cur = gesture.current
    const p = toScene(e)
    if (!cur) {
      const grabbed = grab(p)
      const key = grabbed && grabbed.mode === 'move' ? targetKey(grabbed.target) : null
      if (key !== hover) setHover(key)
      surface.current!.style.cursor = !grabbed
        ? ''
        : grabbed.mode === 'scale'
          ? 'nwse-resize'
          : grabbed.mode === 'rotate'
            ? 'grab'
            : 'move'
      return
    }
    if (e.pointerId !== cur.pointerId) return
    const result = cur.move(
      { x: e.clientX, y: e.clientY },
      p,
      { shift: e.shiftKey, alt: e.altKey },
      { w: width, h: height, span },
    )
    if (!result) return
    onEdit(result.edit)
    setLive({ guides: result.guides, text: readout(result.edit) })
  }

  const frameOf = (t: SceneTarget) =>
    orientedCorners(t.frame)
      .map((c) => `${c.x},${c.y}`)
      .join(' ')
  const hovered = hover && hover !== selectedKey ? targets.find((t) => targetKey(t) === hover) : null

  return (
    <div
      ref={surface}
      className="canvas-edit"
      tabIndex={-1}
      style={{ left: -OVERHANG, top: -OVERHANG, width: fullW + OVERHANG * 2, height: height + OVERHANG * 2 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => e.pointerId === gesture.current?.pointerId && finish(true)}
      onPointerCancel={(e) => e.pointerId === gesture.current?.pointerId && finish(false)}
      onLostPointerCapture={(e) => e.pointerId === gesture.current?.pointerId && finish(false)}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={fullW + OVERHANG * 2} height={height + OVERHANG * 2} aria-hidden>
        <g transform={`translate(${OVERHANG} ${OVERHANG})`}>
          {live?.guides.x && (
            <line
              x1={live.guides.x.at}
              x2={live.guides.x.at}
              y1={0}
              y2={height}
              stroke={GUIDE_COLOR}
              strokeWidth={1}
              strokeDasharray={live.guides.x.kind === 'home' ? '4 3' : undefined}
              data-guide={`x-${live.guides.x.kind}`}
            />
          )}
          {live?.guides.y && (
            <line
              x1={0}
              x2={fullW}
              y1={live.guides.y.at}
              y2={live.guides.y.at}
              stroke={GUIDE_COLOR}
              strokeWidth={1}
              strokeDasharray={live.guides.y.kind === 'home' ? '4 3' : undefined}
              data-guide={`y-${live.guides.y.kind}`}
            />
          )}
          {hovered && (
            <polygon
              points={frameOf(hovered)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          {selected && (
            <g data-selected={selectedKey ?? ''}>
              <polygon points={frameOf(selected)} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
              {handles?.rotate && handles.stem && (
                <>
                  <line
                    x1={handles.stem.x}
                    y1={handles.stem.y}
                    x2={handles.rotate.x}
                    y2={handles.rotate.y}
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={handles.rotate.x}
                    cy={handles.rotate.y}
                    r={HANDLE / 2 + 0.5}
                    fill="#fff"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    data-handle="rotate"
                  />
                </>
              )}
              {handles?.scale && (
                <rect
                  x={handles.scale.x - HANDLE / 2}
                  y={handles.scale.y - HANDLE / 2}
                  width={HANDLE}
                  height={HANDLE}
                  rx={1.5}
                  fill="#fff"
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  data-handle="scale"
                />
              )}
            </g>
          )}
        </g>
      </svg>
      {live?.text && <span className="canvas-edit-readout">{live.text}</span>}
    </div>
  )
}
