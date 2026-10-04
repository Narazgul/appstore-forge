import { describe, expect, it } from 'vitest'
import {
  ESCAPE_OVERLAY_SELECTOR,
  isEditableTarget,
  isEscapeOverlayOpen,
  isRedoShortcut,
  isUndoShortcut,
} from './keyboard'

const tag = (tagName: string, contentEditable = false) =>
  ({ tagName, isContentEditable: contentEditable }) as unknown as EventTarget

describe('isEditableTarget', () => {
  it('is true for an input, a textarea and a select', () => {
    expect(isEditableTarget(tag('INPUT'))).toBe(true)
    expect(isEditableTarget(tag('TEXTAREA'))).toBe(true)
    expect(isEditableTarget(tag('SELECT'))).toBe(true)
  })

  it('is true for a contenteditable element', () => {
    expect(isEditableTarget(tag('DIV', true))).toBe(true)
  })

  it('is false for a plain element, and for no target at all', () => {
    expect(isEditableTarget(tag('DIV'))).toBe(false)
    expect(isEditableTarget(tag('BUTTON'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  ...mods,
})

describe('isUndoShortcut', () => {
  it('matches Cmd+Z and Ctrl+Z', () => {
    expect(isUndoShortcut(key('z', { metaKey: true }))).toBe(true)
    expect(isUndoShortcut(key('z', { ctrlKey: true }))).toBe(true)
    expect(isUndoShortcut(key('Z', { ctrlKey: true }))).toBe(true)
  })

  it('does not match with Shift held, or without a modifier', () => {
    expect(isUndoShortcut(key('z', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isUndoShortcut(key('z'))).toBe(false)
  })
})

describe('isRedoShortcut', () => {
  it('matches Cmd+Shift+Z, Ctrl+Shift+Z and Ctrl+Y', () => {
    expect(isRedoShortcut(key('z', { metaKey: true, shiftKey: true }))).toBe(true)
    expect(isRedoShortcut(key('z', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isRedoShortcut(key('y', { ctrlKey: true }))).toBe(true)
  })

  it('does not match plain Ctrl+Z or an unmodified key', () => {
    expect(isRedoShortcut(key('z', { ctrlKey: true }))).toBe(false)
    expect(isRedoShortcut(key('y'))).toBe(false)
  })
})

describe('isEscapeOverlayOpen', () => {
  it('is true only while an Escape-owning popover is in the document', () => {
    const asked: string[] = []
    const doc = (found: unknown) => ({
      querySelector: (sel: string) => (asked.push(sel), found),
    })
    expect(isEscapeOverlayOpen(doc({}) as unknown as Document)).toBe(true)
    expect(isEscapeOverlayOpen(doc(null) as unknown as Document)).toBe(false)
    expect(asked).toEqual([ESCAPE_OVERLAY_SELECTOR, ESCAPE_OVERLAY_SELECTOR])
  })
})
