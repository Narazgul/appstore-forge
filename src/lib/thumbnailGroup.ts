/** One item positioned in a sequence of store tiles, alongside how many tiles it takes, whether any
 *  of those tiles falls inside the leading group, and how many of them do (`shown`). */
export type TileGroupRow<T> = { item: T; span: number; inGroup: boolean; shown: number }

/**
 * Which leading items in `items` sit among the first `groupSize` store *tiles* — a multi-tile
 * item (a span-2 layout) counts once per tile it produces, and is "in" the group the moment any of
 * its tiles falls inside the boundary, so an item straddling it is fenced whole rather than split.
 * `shown` still counts only the tiles inside the boundary: of a panorama straddling it, the search
 * result shows the first tile and not the second. `groupSize` of `undefined` groups nothing (every
 * row comes back `inGroup: false`, `shown: 0`), which is what `StorePreview.tsx`'s ordinary
 * (non-thumbnail-test) view wants.
 */
export function groupLeadingTiles<T>(
  items: T[],
  spanOf: (item: T) => number,
  groupSize: number | undefined,
): TileGroupRow<T>[] {
  return items.reduce<TileGroupRow<T>[]>((rows, item) => {
    const span = spanOf(item)
    const tileIndex = rows.reduce((n, r) => n + r.span, 0)
    const inGroup = groupSize !== undefined && tileIndex < groupSize
    const shown = inGroup ? Math.min(span, groupSize - tileIndex) : 0
    return [...rows, { item, span, inGroup, shown }]
  }, [])
}

/** The fence's caption: how many tiles the search result really shows, never more than it holds. */
export function searchResultLabel(rows: TileGroupRow<unknown>[]): string {
  const shown = rows.reduce((n, r) => n + r.shown, 0)
  return shown === 1
    ? 'This tile appears in the search result'
    : `These ${shown} tiles appear in the search result`
}
