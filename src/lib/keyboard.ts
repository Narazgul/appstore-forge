const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * True when the keyboard focus is inside a field that owns its own undo (native text editing,
 * a select, or contenteditable) — a global Undo/Redo shortcut must not intercept there.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  if (EDITABLE_TAGS.has(el.tagName)) return true
  return el.isContentEditable === true
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>

export function isUndoShortcut(e: KeyLike): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z'
}

export function isRedoShortcut(e: KeyLike): boolean {
  const key = e.key.toLowerCase()
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && key === 'z') return true
  return e.ctrlKey && !e.metaKey && key === 'y'
}

/** The popovers that own Escape while they are open: it closes them and must not also reach the canvas. */
export const ESCAPE_OVERLAY_SELECTOR = '.ideas-popover'

export function isEscapeOverlayOpen(doc: Pick<Document, 'querySelector'>): boolean {
  return doc.querySelector(ESCAPE_OVERLAY_SELECTOR) !== null
}
