import { describe, expect, it } from 'vitest'
import { groupLeadingTiles, searchResultLabel } from './thumbnailGroup'

const spanOf = (n: number) => n

describe('groupLeadingTiles', () => {
  it('groups nothing when groupSize is undefined', () => {
    const rows = groupLeadingTiles([1, 1, 1], spanOf, undefined)
    expect(rows.map((r) => r.inGroup)).toEqual([false, false, false])
    expect(rows.map((r) => r.shown)).toEqual([0, 0, 0])
  })

  it('groups exactly the first N single-tile items', () => {
    const rows = groupLeadingTiles([1, 1, 1, 1], spanOf, 3)
    expect(rows.map((r) => r.inGroup)).toEqual([true, true, true, false])
    expect(searchResultLabel(rows)).toBe('These 3 tiles appear in the search result')
  })

  it('fences a span-2 item whole when it starts inside the boundary, even past groupSize', () => {
    // Tiles: [0-1] span2, [2] span1, [3] span1 — groupSize 3 falls inside the span-2 item's own
    // second tile, so it is kept whole rather than split.
    const rows = groupLeadingTiles([2, 1, 1], spanOf, 3)
    expect(rows.map((r) => r.inGroup)).toEqual([true, true, false])
    const groupedTileCount = rows.filter((r) => r.inGroup).reduce((n, r) => n + r.span, 0)
    expect(groupedTileCount).toBe(3)
    expect(rows.map((r) => r.shown)).toEqual([2, 1, 0])
  })

  it('keeps a span-2 item in the group even when it pushes the tile count past groupSize', () => {
    // Tiles: [0] span1, [1] span1, [2-3] span2 — the third item starts at tile index 2, inside the
    // first 3 tiles, so the whole item (both its tiles) is fenced, for 4 tiles total.
    const rows = groupLeadingTiles([1, 1, 2, 1], spanOf, 3)
    expect(rows.map((r) => r.inGroup)).toEqual([true, true, true, false])
    const groupedTileCount = rows.filter((r) => r.inGroup).reduce((n, r) => n + r.span, 0)
    expect(groupedTileCount).toBe(4)
    // Fenced whole, but the search result shows only its first tile: three tiles, not four.
    expect(rows.map((r) => r.shown)).toEqual([1, 1, 1, 0])
    expect(searchResultLabel(rows)).toBe('These 3 tiles appear in the search result')
  })

  it('groups nothing beyond the available items', () => {
    const rows = groupLeadingTiles([1, 1], spanOf, 5)
    expect(rows.every((r) => r.inGroup)).toBe(true)
    expect(searchResultLabel(rows)).toBe('These 2 tiles appear in the search result')
    expect(searchResultLabel(groupLeadingTiles([1], spanOf, 3))).toBe(
      'This tile appears in the search result',
    )
  })
})
