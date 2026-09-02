import { describe, expect, it } from 'vitest'
import {
  HEAD_LH,
  availableTextHeight,
  blockHeight,
  layoutText,
  parseMarkup,
  stripMarkup,
  wrap,
  type TextMeasurer,
} from './text'
import { getLayout } from '../presets/layouts'
import { DEFAULT_SETTINGS } from '../store'
import type { Screen } from '../types'

/** A stub canvas: every glyph is 10 units wide, so widths are predictable and exact. */
const measurer = (perChar = 10): TextMeasurer => ({
  font: '',
  letterSpacing: '0px',
  measureText: (text: string) => ({ width: text.length * perChar }),
})

const screen = (headline: string, subhead = ''): Screen => ({
  id: 'test',
  headline,
  subhead,
  imageId: null,
  overrides: {},
})

describe('parseMarkup', () => {
  it('tags no span on plain text', () => {
    expect(parseMarkup('one two')).toEqual([
      { text: 'one', span: -1 },
      { text: 'two', span: -1 },
    ])
  })

  it('numbers each starred span so highlight colours can cycle', () => {
    expect(parseMarkup('a *b* c *d*')).toEqual([
      { text: 'a', span: -1 },
      { text: 'b', span: 0 },
      { text: 'c', span: -1 },
      { text: 'd', span: 1 },
    ])
  })

  it('keeps every word of a multi-word span in the same span', () => {
    expect(parseMarkup('*two words* after').map((w) => w.span)).toEqual([0, 0, -1])
  })

  it('drops an unmatched trailing star rather than highlighting the tail', () => {
    expect(parseMarkup('plain *dangling').map((w) => w.span)).toEqual([-1, -1])
  })

  it('collapses runs of whitespace', () => {
    expect(parseMarkup('  a \n  b  ').map((w) => w.text)).toEqual(['a', 'b'])
  })

  it('returns nothing for empty input', () => {
    expect(parseMarkup('')).toEqual([])
  })
})

describe('stripMarkup', () => {
  it('gives back the sentence without stars, for export filenames', () => {
    expect(stripMarkup('Track *every* habit')).toBe('Track every habit')
  })
})

describe('wrap', () => {
  const ctx = measurer()

  it('keeps words on one line while they fit', () => {
    const lines = wrap(ctx, parseMarkup('aa bb'), 1000)
    expect(lines).toHaveLength(1)
    // two 20-wide words plus a 10-wide space
    expect(lines[0].width).toBe(50)
  })

  it('breaks to a new line at the width limit', () => {
    const lines = wrap(ctx, parseMarkup('aaaa bbbb cccc'), 90)
    expect(lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['aaaa bbbb', 'cccc'])
  })

  it('never drops a word too long for the line — it overflows instead', () => {
    const lines = wrap(ctx, parseMarkup('supercalifragilistic'), 20)
    expect(lines).toHaveLength(1)
    expect(lines[0].words[0].text).toBe('supercalifragilistic')
  })

  it('returns no lines for no words, so an empty subhead adds no height', () => {
    expect(wrap(ctx, [], 500)).toEqual([])
  })

  it('records a per-word width for every word, which drawing relies on', () => {
    const [line] = wrap(ctx, parseMarkup('a bb ccc'), 1000)
    expect(line.widths).toEqual([10, 20, 30])
  })
})

describe('layoutText', () => {
  const H = 2868

  it('keeps the requested size when the copy already fits', () => {
    const block = layoutText(measurer(), screen('Short'), DEFAULT_SETTINGS, 10_000, H, H)
    expect(block.headSize).toBeCloseTo(H * 0.04, 5)
  })

  it('shrinks until the block fits the available height', () => {
    const long = screen('one two three four five six seven eight nine ten eleven twelve')
    const maxHeight = H * 0.05
    const block = layoutText(measurer(), long, DEFAULT_SETTINGS, 400, maxHeight, H)
    expect(blockHeight(block)).toBeLessThanOrEqual(maxHeight)
    expect(block.headSize).toBeLessThan(H * 0.04)
  })

  it('stops shrinking at the floor instead of vanishing', () => {
    const block = layoutText(measurer(), screen('a b c d e f g h'), DEFAULT_SETTINGS, 10, 1, H)
    expect(block.headSize).toBeGreaterThan(0)
  })

  it('scales with the headline multiplier', () => {
    const big = { ...DEFAULT_SETTINGS, headlineScale: 1.5 }
    const a = layoutText(measurer(), screen('Hi'), DEFAULT_SETTINGS, 10_000, H, H)
    const b = layoutText(measurer(), screen('Hi'), big, 10_000, H, H)
    expect(b.headSize).toBeCloseTo(a.headSize * 1.5, 5)
  })

  it('adds the gap only when there is a subhead', () => {
    const withSub = layoutText(measurer(), screen('Head', 'Sub'), DEFAULT_SETTINGS, 10_000, H, H)
    const without = layoutText(measurer(), screen('Head'), DEFAULT_SETTINGS, 10_000, H, H)
    expect(blockHeight(without)).toBeCloseTo(without.headLines.length * without.headSize * HEAD_LH, 5)
    expect(blockHeight(withSub)).toBeGreaterThan(blockHeight(without))
  })
})

describe('availableTextHeight', () => {
  it('is zero for a layout with no text band', () => {
    expect(availableTextHeight(getLayout('centered'), 1000)).toBe(0)
  })

  it('gives copy above the device the room up to the device band', () => {
    const layout = getLayout('text-top')
    // The whole gap to the device, not just the nominal band, so the size slider stays usable.
    expect(availableTextHeight(layout, 1000)).toBeGreaterThanOrEqual(layout.text!.height * 1000)
  })

  it('gives copy below the device the room down to the bottom edge', () => {
    const layout = getLayout('text-bottom')
    expect(availableTextHeight(layout, 1000)).toBeGreaterThanOrEqual(layout.text!.height * 1000)
  })
})

describe('wrap with a language', () => {
  it('breaks Chinese inside a run of characters instead of keeping it on one line', () => {
    const words = parseMarkup('见证财富增长每一天')
    const lines = wrap(measurer(10), words, 45, 'zh')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(45)
  })

  it('marks segmenter pieces as glued so no space is inserted between them', () => {
    const lines = wrap(measurer(10), parseMarkup('见证财富'), 1000, 'zh')
    const words = lines.flatMap((l) => l.words)
    expect(words.length).toBeGreaterThan(1)
    expect(words.slice(1).every((w) => w.glue)).toBe(true)
    expect(lines[0].width).toBe(40)
  })

  it('keeps a Latin word whole', () => {
    const lines = wrap(measurer(10), parseMarkup('budget meistern'), 1000, 'de')
    expect(lines[0].words.map((w) => w.text)).toEqual(['budget', 'meistern'])
    expect(lines[0].width).toBe(150)
  })

  it('keeps the highlight span on every glued piece', () => {
    const lines = wrap(measurer(10), parseMarkup('*财富增长*'), 1000, 'zh')
    expect(lines[0].words.every((w) => w.span === 0)).toBe(true)
  })
})
