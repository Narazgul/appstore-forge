import { describe, expect, it } from 'vitest'
import { backgroundIdFor } from '../project/bridge'
import type { Screen } from '../types'
import { sceneSources } from './export'

const img = (name: string) => ({ name }) as unknown as HTMLImageElement
const screen = (id: string, extra: Partial<Screen> = {}): Screen => ({
  id,
  headline: id,
  subhead: '',
  imageId: id,
  overrides: {},
  ...extra,
})

describe('sceneSources', () => {
  const images = {
    a: img('a'),
    b: img('b'),
    c: img('c'),
    pair: img('pair'),
    before: img('before'),
    art: img('art'),
    sticker: img('sticker'),
    cell: img('cell'),
    [backgroundIdFor('bg/meadow.jpg')]: img('meadow'),
  }

  it('wraps to the neighbours when nothing names an image', () => {
    const screens = [screen('a'), screen('b'), screen('c')]
    const s = sceneSources(screens, 0, images)
    expect([s.self, s.next, s.prev]).toEqual([images.a, images.b, images.c])
  })

  it('hands the renderer every image a tile names, not only self, next and prev', () => {
    const named = screen('a', {
      pairId: 'pair',
      pairPrevId: 'before',
      artworkId: 'art',
      elements: [{ id: 's', imageId: 'sticker', x: 0.5, y: 0.5, width: 0.2, rotate: 0 } as never],
      extraIds: ['cell', 'missing'],
    })
    const s = sceneSources([named, screen('b')], 0, images)
    expect(s.next).toBe(images.pair)
    expect(s.prev).toBe(images.before)
    expect(s.artwork).toBe(images.art)
    expect(s.elements).toEqual({ sticker: images.sticker })
    expect(s.extra).toEqual([images.cell, null])
    expect(s.backgrounds).toEqual({ 'bg/meadow.jpg': images[backgroundIdFor('bg/meadow.jpg')] })
  })
})
