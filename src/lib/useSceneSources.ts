import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SceneSources } from '../render/scene'
import { placeholderScreenshot } from '../render/placeholder'
import { backgroundIdFor } from '../project/bridge'
import { useStore } from '../store'
import { isStickerElement } from '../types'
import type { Screen } from '../types'

const BACKGROUND_PREFIX = backgroundIdFor('')

/**
 * Neighbouring screenshots, wrapping around so multi-device arrangements never show a gap.
 * An unfilled slot previews with the drawn stand-in; export is gated until every slot is filled.
 * `screens` overrides the strip to look the neighbours up in — a review strip of another language.
 */
export function useSceneSources(screen: Screen, screens?: Screen[]): SceneSources {
  const base = useStore(
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
  // A dedicated selector: an array is what `useShallow` can compare entry by entry, so the
  // sticker images stay a stable reference across store updates that touch neither of them —
  // building the keyed record straight in the selector would hand back a fresh object every
  // time and trip the same "fresh object" loop `useShallow` exists to avoid (rules.md #7). A
  // shape carries no image at all, so it never reaches this registry.
  const elementImages = useStore(
    useShallow((s) =>
      (screen.elements ?? []).filter(isStickerElement).map((el) => s.images[el.imageId] ?? null),
    ),
  )
  const elements = useMemo(() => {
    const stickers = (screen.elements ?? []).filter(isStickerElement)
    return Object.fromEntries(stickers.map((el, i) => [el.imageId, elementImages[i]]))
  }, [screen.elements, elementImages])
  // The mosaic layout's cells after the first — a dedicated selector for the same reason as
  // `elementImages`: an array is what `useShallow` compares entry by entry.
  const extra = useStore(useShallow((s) => (screen.extraIds ?? []).map((id) => s.images[id] ?? null)))
  // Every background image the set has loaded; the renderer picks the one the screen's effective
  // background names, which this hook cannot resolve without the settings.
  const backgroundKeys = useStore(
    useShallow((s) => Object.keys(s.images).filter((key) => key.startsWith(BACKGROUND_PREFIX))),
  )
  const backgroundImages = useStore(useShallow((s) => backgroundKeys.map((key) => s.images[key] ?? null)))
  const backgrounds = useMemo(
    () =>
      Object.fromEntries(
        backgroundKeys.map((key, i) => [key.slice(BACKGROUND_PREFIX.length), backgroundImages[i]]),
      ),
    [backgroundKeys, backgroundImages],
  )
  return useMemo(() => ({ ...base, elements, extra, backgrounds }), [base, elements, extra, backgrounds])
}
