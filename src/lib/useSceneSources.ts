import { useShallow } from 'zustand/react/shallow'
import type { SceneSources } from '../render/scene'
import { placeholderScreenshot } from '../render/placeholder'
import { useStore } from '../store'
import type { Screen } from '../types'

/**
 * Neighbouring screenshots, wrapping around so multi-device arrangements never show a gap.
 * An unfilled slot previews with the drawn stand-in; export is gated until every slot is filled.
 * `screens` overrides the strip to look the neighbours up in — a review strip of another language.
 */
export function useSceneSources(screen: Screen, screens?: Screen[]): SceneSources {
  return useStore(
    useShallow((s) => {
      const strip = screens ?? s.screens
      const at = (i: number) => {
        const target = strip[(i + strip.length) % (strip.length || 1)]
        if (!target) return null
        return target.imageId ? (s.images[target.imageId] ?? null) : placeholderScreenshot()
      }
      const artwork = screen.artworkId ? (s.images[screen.artworkId] ?? null) : null
      // A named pair replaces the neighbour, so a duo can show a screen the strip does not hold.
      const pair = screen.pairId ? (s.images[screen.pairId] ?? null) : null
      const pairPrev = screen.pairPrevId ? (s.images[screen.pairPrevId] ?? null) : null
      const index = strip.findIndex((x) => x.id === screen.id)
      if (index < 0) return { self: null, next: pair, prev: pairPrev, artwork }
      return {
        self: at(index),
        next: screen.pairId ? pair : at(index + 1),
        prev: screen.pairPrevId ? pairPrev : at(index - 1),
        artwork,
      }
    }),
  )
}
