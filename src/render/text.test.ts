import { describe, expect, it } from 'vitest'
import {
  drawListBlock,
  drawTextBlock,
  BASELINE,
  CHIP_PAD_X,
  CHIP_SIZE_FLOOR,
  HEAD_LH,
  LABEL_PAD_X,
  LIST_LH,
  availableTextHeight,
  blockHeight,
  fitChipText,
  headlineBaseSize,
  layoutList,
  layoutText,
  measureListBlock,
  parseMarkup,
  stripMarkup,
  wrap,
  type TextMeasurer,
} from './text'
import { LAYOUTS, getLayout } from '../presets/layouts'
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

  it('marks the word after a `\\n` as a forced break', () => {
    expect(parseMarkup('Save time\nevery day')).toEqual([
      { text: 'Save', span: -1 },
      { text: 'time', span: -1 },
      { text: 'every', span: -1, break: true },
      { text: 'day', span: -1 },
    ])
  })

  it('keeps a span across a forced break, still counting as one span', () => {
    expect(parseMarkup('*Save\ntime*').map((w) => w.span)).toEqual([0, 0])
    expect(parseMarkup('*Save\ntime*').map((w) => !!w.break)).toEqual([false, true])
  })

  it('does not mark a leading break when the copy starts with a newline', () => {
    expect(parseMarkup('\nHello')).toEqual([{ text: 'Hello', span: -1 }])
  })

  it('normalises a Windows line ending to a forced break', () => {
    expect(parseMarkup('one\r\ntwo').map((w) => !!w.break)).toEqual([false, true])
  })
})

/** A line's text as drawn: a space in front of every word except a glued one. */
const drawnText = (line: { words: { text: string; glue?: boolean }[] }) =>
  line.words.map((w, i) => (i && !w.glue ? ' ' : '') + w.text).join('')

describe('markup without whitespace at a star', () => {
  const ctx = measurer()

  it('sets punctuation right after a span without a space', () => {
    const lines = wrap(ctx, parseMarkup('*Söyle*, yeter'), 1000)
    expect(lines.map(drawnText)).toEqual(['Söyle, yeter'])
    expect(lines[0].width).toBe(120)
  })

  it('sets a span inside a CJK run without spaces around it', () => {
    const lines = wrap(ctx, parseMarkup('數位*信封*理財法'), 1000)
    expect(lines[0].width).toBe(70)
  })

  it('keeps the CJK run unspaced when the segmenter splits it for a language', () => {
    const lines = wrap(ctx, parseMarkup('數位*信封*理財法'), 1000, 'zh-TW')
    expect(lines[0].width).toBe(70)
  })

  it('sets a span inside a Latin word without spaces', () => {
    const lines = wrap(ctx, parseMarkup('un*glaub*lich'), 1000)
    expect(lines.map(drawnText)).toEqual(['unglaublich'])
  })

  it('brings the whole marker span down with the punctuation that hangs on it', () => {
    const lines = wrap(ctx, parseMarkup('Sag *es einfach*, bitte'), 145)
    expect(lines.map(drawnText)).toEqual(['Sag', 'es einfach,', 'bitte'])
  })

  it('lets hanging punctuation overflow rather than start a line of its own', () => {
    const lines = wrap(ctx, parseMarkup('*Unabhängigkeit*, klar'), 145)
    expect(lines.map(drawnText)).toEqual(['Unabhängigkeit,', 'klar'])
  })

  it('never starts a line with the punctuation that hangs on a span', () => {
    const lines = wrap(ctx, parseMarkup('aaaa *bbbb*, cc'), 90)
    expect(lines.map(drawnText)).toEqual(['aaaa', 'bbbb, cc'])
  })

  it('still breaks a CJK run at a star, as between any two CJK characters', () => {
    const lines = wrap(ctx, parseMarkup('數位*信封*理財法'), 50)
    expect(lines.map(drawnText)).toEqual(['數位信封', '理財法'])
  })

  it('keeps the space where the copy has one', () => {
    const lines = wrap(ctx, parseMarkup('Track *every* habit'), 1000)
    expect(lines[0].width).toBe(170)
  })
})

describe('stripMarkup', () => {
  it('gives back the sentence without stars, for export filenames', () => {
    expect(stripMarkup('Track *every* habit')).toBe('Track every habit')
  })

  it('joins a forced break with a single space', () => {
    expect(stripMarkup('Track *every*\nhabit')).toBe('Track every habit')
  })

  it('adds no space where a star sits against a word or punctuation', () => {
    expect(stripMarkup('*Söyle*, yeter')).toBe('Söyle, yeter')
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

  it('moves a whole marker span to the next line rather than splitting the band', () => {
    // 'Jeder Euro ein' is 140 wide, adding ' Ziel' makes 190 — the span is 80 and fits alone.
    const lines = wrap(ctx, parseMarkup('Jeder Euro *ein Ziel*'), 150)
    expect(lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['Jeder Euro', 'ein Ziel'])
    expect(lines.map((l) => l.width)).toEqual([100, 80])
  })

  it('still breaks inside a span that is wider than the line', () => {
    const lines = wrap(ctx, parseMarkup('*aaaa bbbb cccc*'), 90)
    expect(lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['aaaa bbbb', 'cccc'])
  })

  it('leaves words outside a span where they were', () => {
    const lines = wrap(ctx, parseMarkup('Jeder Euro ein Ziel'), 150)
    expect(lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual(['Jeder Euro ein', 'Ziel'])
  })

  it('records a per-word width for every word, which drawing relies on', () => {
    const [line] = wrap(ctx, parseMarkup('a bb ccc'), 1000)
    expect(line.widths).toEqual([10, 20, 30])
  })

  it('breaks at a `\\n` even though both words would fit on one line', () => {
    const lines = wrap(ctx, parseMarkup('aa\nbb'), 1000)
    expect(lines.map((l) => l.words.map((w) => w.text))).toEqual([['aa'], ['bb']])
  })

  it('keeps a span across the forced break it was given', () => {
    const lines = wrap(ctx, parseMarkup('*aa\nbb*'), 1000)
    expect(lines).toHaveLength(2)
    expect(lines.flatMap((l) => l.words).every((w) => w.span === 0)).toBe(true)
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

  it('reports a fit when the copy is inside the available height', () => {
    expect(layoutText(measurer(), screen('Short'), DEFAULT_SETTINGS, 10_000, H, H).fits).toBe(true)
    const shrunk = layoutText(
      measurer(),
      screen('one two three four five six seven eight nine ten eleven twelve'),
      DEFAULT_SETTINGS,
      400,
      H * 0.05,
      H,
    )
    expect(shrunk.fits).toBe(true)
  })

  it('reports no fit when the shrink hits the floor', () => {
    const block = layoutText(measurer(), screen('a b c d e f g h'), DEFAULT_SETTINGS, 10, 1, H)
    expect(block.fits).toBe(false)
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

  it('a forced break can make the copy too long on its own, not just wrapping', () => {
    // A wide box, so nothing here would wrap on width — only the 8 forced breaks add lines.
    const block = layoutText(measurer(), screen('a\nb\nc\nd\ne\nf\ng\nh'), DEFAULT_SETTINGS, 10_000, 1, H)
    expect(block.headLines).toHaveLength(8)
    expect(block.fits).toBe(false)
  })

  it('defaults textScale to 1, unchanged from before the parameter existed', () => {
    const withDefault = layoutText(measurer(), screen('Hi'), DEFAULT_SETTINGS, 10_000, H, H)
    const explicit = layoutText(measurer(), screen('Hi'), DEFAULT_SETTINGS, 10_000, H, H, 1)
    expect(explicit).toEqual(withDefault)
  })

  it('multiplies both the headline and subhead size by textScale', () => {
    const base = layoutText(measurer(), screen('Hi', 'Sub'), DEFAULT_SETTINGS, 10_000, H, H)
    const scaled = layoutText(measurer(), screen('Hi', 'Sub'), DEFAULT_SETTINGS, 10_000, H, H, 5)
    expect(scaled.headSize).toBeCloseTo(base.headSize * 5, 5)
    expect(scaled.subSize).toBeCloseTo(base.subSize * 5, 5)
  })
})

describe('fitChipText', () => {
  it('keeps the requested size when the text already fits', () => {
    const fit = fitChipText(measurer(), 'Hi', DEFAULT_SETTINGS, 10_000, 40)
    expect(fit.size).toBe(40)
    expect(fit.fits).toBe(true)
    expect(fit.textWidth).toBe(20)
  })

  it('shrinks until the pill (text plus its own padding) fits maxWidth', () => {
    // At size 40 the text (20) plus its padding (2 × 0.8 × 40 = 64) is 84, past a 75-wide box —
    // but the floor (0.7 × 40 = 28) still leaves room to fit before shrinking that far.
    const fit = fitChipText(measurer(), 'Hi', DEFAULT_SETTINGS, 75, 40)
    expect(fit.size).toBeLessThan(40)
    expect(fit.fits).toBe(true)
    expect(fit.textWidth + fit.size * CHIP_PAD_X * 2).toBeLessThanOrEqual(75)
  })

  it('never shrinks below the floor', () => {
    const fit = fitChipText(measurer(), 'A very long chip text indeed', DEFAULT_SETTINGS, 10, 40)
    expect(fit.size).toBeCloseTo(40 * CHIP_SIZE_FLOOR, 5)
  })

  it('reports no fit when even the floor overruns maxWidth', () => {
    const fit = fitChipText(measurer(), 'A very long chip text indeed', DEFAULT_SETTINGS, 10, 40)
    expect(fit.fits).toBe(false)
  })

  it('reports a fit once shrinking clears the width, not only at the exact requested size', () => {
    // The stub measures the whole string regardless of font size — 'one two three'.length is 13,
    // so the text alone is 130 wide; only the padding shrinks, and it has to shrink to fit 185.
    const fit = fitChipText(measurer(), 'one two three', DEFAULT_SETTINGS, 185, 40)
    expect(fit.fits).toBe(true)
    expect(fit.size).toBeLessThan(40)
  })
})

describe('eyebrow', () => {
  const H = 2868

  it('adds nothing to the measurement when there is none — identical to before the feature', () => {
    const block = layoutText(measurer(), screen('Short'), DEFAULT_SETTINGS, 10_000, H, H)
    expect(block.eyebrowLine).toBeNull()
    expect(block.eyebrowFits).toBe(true)
    expect(blockHeight(block)).toBeCloseTo(block.headLines.length * block.headSize * HEAD_LH, 5)
  })

  it('adds its height above the headline when present', () => {
    const s = { ...screen('Short'), eyebrow: 'New' }
    const withEyebrow = layoutText(measurer(), s, DEFAULT_SETTINGS, 10_000, H, H)
    const without = layoutText(measurer(), screen('Short'), DEFAULT_SETTINGS, 10_000, H, H)
    expect(withEyebrow.eyebrowLine).not.toBeNull()
    expect(blockHeight(withEyebrow)).toBeGreaterThan(blockHeight(without))
  })

  it('uppercases the eyebrow and treats stars literally, not as markup', () => {
    const s = { ...screen('Head'), eyebrow: 'a *b*' }
    const block = layoutText(measurer(), s, DEFAULT_SETTINGS, 10_000, H, H)
    expect(block.eyebrowLine!.words).toEqual([{ text: 'A *B*', span: -1 }])
  })

  it('reports eyebrowFits false when the (unwrapped) eyebrow is wider than the box', () => {
    const s = { ...screen('Hi'), eyebrow: 'a rather long eyebrow line indeed' }
    const block = layoutText(measurer(), s, DEFAULT_SETTINGS, 50, H, H)
    expect(block.eyebrowFits).toBe(false)
  })

  it('reports eyebrowFits true when it fits on one line', () => {
    const s = { ...screen('Hi'), eyebrow: 'ok' }
    const block = layoutText(measurer(), s, DEFAULT_SETTINGS, 10_000, H, H)
    expect(block.eyebrowFits).toBe(true)
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

  it('is exactly the text band for a deviceless layout — there is no device gap to grow into', () => {
    const layout = getLayout('text-only')
    expect(availableTextHeight(layout, 1000)).toBe(layout.text!.height * 1000)
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

  it('keeps trailing punctuation on a Latin word', () => {
    const whole = (text: string) =>
      wrap(measurer(10), parseMarkup(text), 1000, 'de')[0].words.map((w) => w.text)
    expect(whole('Monat.')).toEqual(['Monat.'])
    expect(whole('$9.99')).toEqual(['$9.99'])
    expect(whole('50%')).toEqual(['50%'])
  })

  it('keeps CJK punctuation attached to the preceding character', () => {
    const lines = wrap(measurer(10), parseMarkup('见证财富增长每一天，'), 40, 'zh')
    const texts = lines.map((l) => l.words.map((w) => w.text).join(''))
    expect(texts.join('')).toBe('见证财富增长每一天，')
    expect(texts.some((t) => t.startsWith('，'))).toBe(false)
    expect(lines.flatMap((l) => l.words).some((w) => w.text.endsWith('天，'))).toBe(true)
  })
})

describe('a lone CJK character on the last line', () => {
  const texts = (src: string, width: number, lang: string) =>
    wrap(measurer(10), parseMarkup(src), width, lang).map((l) => l.words.map((w) => w.text).join(''))

  it('takes the piece before it down, so the last line is never one character', () => {
    const plain = wrap(measurer(10), parseMarkup('見證財富增長每一天'), 90, 'zh')
    expect(plain).toHaveLength(1)
    const lines = wrap(measurer(10), parseMarkup('見證財富增長每一天に'), 90, 'ja')
    const rows = lines.map((l) => l.words.map((w) => w.text).join(''))
    expect(rows.join('')).toBe('見證財富增長每一天に')
    for (const row of rows) expect(row.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(90)
  })

  it('leaves a line alone that has more than one character, and Latin text', () => {
    expect(texts('見證財富增長每一天に', 100, 'ja')).toHaveLength(1)
    expect(texts('budget a', 60, 'de')).toEqual(['budget', 'a'])
  })

  it('keeps a marker band whole instead of tearing it', () => {
    const lines = wrap(measurer(10), parseMarkup('*見證財富增長每一天*に'), 90, 'ja')
    const spans = lines.map((l) => l.words.map((w) => w.span))
    expect(spans.flat().filter((s) => s === 0).length).toBeGreaterThan(0)
    expect(lines.map((l) => l.words.map((w) => w.text).join('')).join('')).toBe('見證財富增長每一天に')
  })
})

/** A canvas stand-in: 10 units per character, and it writes down where things landed. Shared by
 *  every `drawTextBlock` describe block below. */
const recorder = () => {
  const texts: { text: string; x: number; y: number; color: string; font: string; alpha: number }[] = []
  const bands: { left: number; right: number; top: number; height: number; color: string }[] = []
  const ctx = {
    font: '',
    letterSpacing: '0px',
    textAlign: 'left',
    textBaseline: 'top',
    direction: 'ltr',
    fillStyle: '',
    globalAlpha: 1,
    measureText: (text: string) => ({ width: text.length * 10 }),
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    fill: () => {},
    roundRect: (x: number, y: number, w: number, h: number) =>
      bands.push({ left: x, right: x + w, top: y, height: h, color: ctx.fillStyle }),
    fillText: (text: string, x: number, y: number) =>
      texts.push({ text, x, y, color: ctx.fillStyle, font: ctx.font, alpha: ctx.globalAlpha }),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, bands, state: ctx }
}

describe('drawTextBlock baseline', () => {
  it('sets a line on the fixed baseline below the top of its em box, not on the engine\'s "top"', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, 500, 250, 1000, getLayout('panorama'), screen('*Head*'), DEFAULT_SETTINGS)
    expect(rec.state.textBaseline).toBe('alphabetic')
    const band = rec.bands[0]
    const size = band.height / 0.98
    const emTop = band.top - size * 0.1
    expect(rec.texts[0].y).toBeCloseTo(emTop + size * BASELINE, 6)
  })
})

describe('drawTextBlock geometry', () => {
  // 'panorama' pins the text box explicitly, so boxLeft and maxWidth are exact.
  const layout = getLayout('panorama')
  const W = 500
  const boxLeft = W * layout.text!.left!
  const maxWidth = W * layout.text!.width!
  // 11 + 6 characters plus one space fill the box exactly, so the block spans the whole width.
  const HEAD = '*ministerium sicher*'
  const left = { ...DEFAULT_SETTINGS, textAlign: 'left' as const }

  const render = (lang?: string) => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, { ...screen(HEAD), lang }, left)
    return rec
  }

  it('lays an RTL line out from the right edge of the text box', () => {
    const { texts } = render('ar')
    expect(texts.map((t) => t.text)).toEqual(['ministerium', 'sicher'])
    expect(texts[0].x).toBeCloseTo(boxLeft + maxWidth - 110, 6)
    expect(texts[1].x).toBeCloseTo(boxLeft, 6)
  })

  it('lays the same line out from the left edge for an LTR language', () => {
    const { texts } = render('de')
    expect(texts[0].x).toBeCloseTo(boxLeft, 6)
    expect(texts[1].x).toBeCloseTo(boxLeft + 120, 6)
  })

  it('puts the context into RTL so the engine shapes the run right to left', () => {
    expect(render('ar').state.direction).toBe('rtl')
    expect(render('de').state.direction).toBe('ltr')
  })

  it('spans the marker band across an RTL phrase whatever the word order', () => {
    const { texts, bands } = render('ar')
    expect(bands).toHaveLength(1)
    const widths = [110, 60]
    expect(bands[0].left).toBeLessThanOrEqual(Math.min(...texts.map((t) => t.x)))
    expect(bands[0].right).toBeGreaterThanOrEqual(Math.max(...texts.map((t, i) => t.x + widths[i])))
  })

  it('draws the eyebrow uppercase, above the headline, with no highlight band of its own', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, { ...screen(HEAD), eyebrow: 'new here' }, left)
    expect(rec.texts[0].text).toBe('NEW HERE')
    expect(rec.texts.slice(1).map((t) => t.text)).toEqual(['ministerium', 'sicher'])
    expect(rec.bands).toHaveLength(1)
  })

  it('treats a star in the eyebrow literally, not as a highlight marker', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, { ...screen('Head'), eyebrow: 'a *b*' }, left)
    expect(rec.texts[0].text).toBe('A *B*')
  })

  it('colors the eyebrow with eyebrowColor when set, else falls back to textColor', () => {
    const s = { ...screen('Head'), eyebrow: 'new' }
    const withColor = recorder()
    drawTextBlock(withColor.ctx, W, 250, 1000, layout, s, { ...left, eyebrowColor: '#ff0000' })
    expect(withColor.texts[0].color).toBe('#ff0000')
    expect(withColor.texts[1].color).toBe(left.textColor)

    const fallback = recorder()
    drawTextBlock(fallback.ctx, W, 250, 1000, layout, s, left)
    expect(fallback.texts[0].color).toBe(left.textColor)
  })
})

describe('textColumn (landscape-left/right)', () => {
  const s = screen('Budget erstellen mit der Regel heute', 'So planst du')
  const firstX = (rec: ReturnType<typeof recorder>, word: string) => rec.texts.find((t) => t.text === word)!.x

  it('puts a short subhead under the headline edge when the block is centred', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, 1200, 1200, 630, getLayout('landscape-left'), s, DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.textAlign).toBe('center')
    expect(firstX(rec, 'So')).toBeCloseTo(firstX(rec, 'Budget'), 6)
  })

  it('aligns RTL rows on the right edge of the column', () => {
    const rec = recorder()
    drawTextBlock(
      rec.ctx,
      1200,
      1200,
      630,
      getLayout('landscape-right'),
      { ...s, lang: 'ar' },
      DEFAULT_SETTINGS,
    )
    const right = (word: string, width: number) => firstX(rec, word) + width
    expect(right('So', 20)).toBeCloseTo(right('Budget', 60), 6)
  })

  it('leaves every other layout aligning row by row', () => {
    expect(LAYOUTS.filter((l) => l.textColumn).map((l) => l.id)).toEqual([
      'landscape-left',
      'landscape-right',
    ])
    const rec = recorder()
    const plain = { ...getLayout('landscape-left'), textColumn: undefined }
    drawTextBlock(rec.ctx, 1200, 1200, 630, plain, s, DEFAULT_SETTINGS)
    expect(firstX(rec, 'So')).toBeGreaterThan(firstX(rec, 'Budget'))
  })
})

describe('accent bar', () => {
  const H = 2868

  it('adds nothing to the measurement when accentBar is null — identical to before the feature', () => {
    const block = layoutText(measurer(), screen('Short'), DEFAULT_SETTINGS, 10_000, H, H)
    expect(block.hasAccentBar).toBe(false)
    expect(blockHeight(block)).toBeCloseTo(block.headLines.length * block.headSize * HEAD_LH, 5)
  })

  it('adds its height above the block when set, growing blockHeight', () => {
    const withBar = { ...DEFAULT_SETTINGS, accentBar: '#5d47e8' }
    const with_ = layoutText(measurer(), screen('Short'), withBar, 10_000, H, H)
    const without = layoutText(measurer(), screen('Short'), DEFAULT_SETTINGS, 10_000, H, H)
    expect(with_.hasAccentBar).toBe(true)
    expect(blockHeight(with_)).toBeGreaterThan(blockHeight(without))
  })

  it('scales with the headline size, like the rest of the block', () => {
    const withBar = { ...DEFAULT_SETTINGS, accentBar: '#5d47e8' }
    const a = layoutText(measurer(), screen('Short'), withBar, 10_000, H, H)
    const big = layoutText(measurer(), screen('Short'), { ...withBar, headlineScale: 1.5 }, 10_000, H, H)
    const aExtra = blockHeight(a) - a.headLines.length * a.headSize * HEAD_LH
    const bigExtra = blockHeight(big) - big.headLines.length * big.headSize * HEAD_LH
    expect(bigExtra).toBeCloseTo(aExtra * 1.5, 5)
  })
})

describe('drawTextBlock accent bar', () => {
  // 'panorama' pins the text box explicitly, so boxLeft and maxWidth are exact.
  const layout = getLayout('panorama')
  const W = 500
  const boxLeft = W * layout.text!.left!
  const maxWidth = W * layout.text!.width!
  const settings = { ...DEFAULT_SETTINGS, textAlign: 'left' as const, accentBar: '#5d47e8' }

  it('draws exactly one rounded bar, in accentBar colour, above the headline', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head'), settings)
    expect(rec.bands).toHaveLength(1)
    expect(rec.bands[0].color).toBe('#5d47e8')
    expect(rec.bands[0].top).toBeLessThan(rec.texts[0].y)
  })

  it('sits flush with the start of the text column for a left-aligned LTR screen', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head'), settings)
    expect(rec.bands[0].left).toBeCloseTo(boxLeft, 6)
  })

  it('sits flush with the right edge of the column for a left-aligned RTL screen', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, { ...screen('Head'), lang: 'ar' }, settings)
    expect(rec.bands[0].right).toBeCloseTo(boxLeft + maxWidth, 6)
  })

  it('centers the bar in the column when textAlign is center', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head'), { ...settings, textAlign: 'center' })
    const barCenter = rec.bands[0].left + (rec.bands[0].right - rec.bands[0].left) / 2
    expect(barCenter).toBeCloseTo(boxLeft + maxWidth / 2, 3)
  })

  it('draws above the eyebrow, when there is one, not just the headline', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, { ...screen('Head'), eyebrow: 'new' }, settings)
    expect(rec.bands[0].top).toBeLessThan(rec.texts[0].y)
    expect(rec.texts[0].text).toBe('NEW')
  })

  it('draws nothing when accentBar is null, exactly as before the feature', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head'), { ...settings, accentBar: null })
    expect(rec.bands).toHaveLength(0)
  })
})

describe('subheadStyle "label"', () => {
  const H = 2868

  it('resolves to "label" only when there are highlights to draw the box in', () => {
    const s = screen('Head', 'Sub')
    const labelSettings = { ...DEFAULT_SETTINGS, subheadStyle: 'label' as const }
    const block = layoutText(measurer(), s, labelSettings, 10_000, H, H)
    expect(block.subheadStyle).toBe('label')
  })

  it('falls back to "plain" when highlights is empty', () => {
    const s = screen('Head', 'Sub')
    const noHighlights = { ...DEFAULT_SETTINGS, subheadStyle: 'label' as const, highlights: [] }
    const block = layoutText(measurer(), s, noHighlights, 10_000, H, H)
    expect(block.subheadStyle).toBe('plain')
  })

  it('measures a different block height than the plain style (its own box geometry, not SUB_LH)', () => {
    const s = screen('Head', 'Sub')
    const plain = layoutText(measurer(), s, DEFAULT_SETTINGS, 10_000, H, H)
    const label = layoutText(
      measurer(),
      s,
      { ...DEFAULT_SETTINGS, subheadStyle: 'label' as const },
      10_000,
      H,
      H,
    )
    expect(blockHeight(label)).not.toBeCloseTo(blockHeight(plain), 0)
  })

  const weightAware = (): TextMeasurer => {
    const m: TextMeasurer = {
      font: '',
      letterSpacing: '0px',
      measureText: (text: string) => ({ width: text.length * (m.font.startsWith('600 ') ? 12 : 10) }),
    }
    return m
  }

  it('measures label lines at the weight they are drawn in', () => {
    const block = layoutText(
      weightAware(),
      screen('Head', 'Sub line'),
      { ...DEFAULT_SETTINGS, subheadStyle: 'label' as const },
      10_000,
      H,
      H,
    )
    expect(block.subLines[0].widths).toEqual([36, 48])
  })

  it('wraps a label line inside the box padding, not the bare text width', () => {
    const settings = { ...DEFAULT_SETTINGS, subheadStyle: 'label' as const }
    const probe = layoutText(weightAware(), screen('H', 'aaaa bbbb'), settings, 10_000, H, H)
    const oneLine = probe.subLines[0].width
    const padding = probe.subSize * LABEL_PAD_X * 2
    const tight = layoutText(weightAware(), screen('H', 'aaaa bbbb'), settings, oneLine + padding / 2, H, H)
    expect(tight.subLines).toHaveLength(2)
  })
})

describe('drawTextBlock subheadStyle "label"', () => {
  const layout = getLayout('panorama')
  const W = 500
  const boxLeft = W * layout.text!.left!
  const settings = {
    ...DEFAULT_SETTINGS,
    textAlign: 'left' as const,
    subheadStyle: 'label' as const,
    highlights: ['#ffe27a'],
    textColor: '#111114',
  }

  it('draws the subhead line on a rounded box filled with highlights[0]', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head', 'Sub'), settings)
    const subBand = rec.bands.find((b) => b.color === '#ffe27a')
    expect(subBand).toBeDefined()
  })

  it('draws the subhead text at weight 600, fully opaque, in textColor', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head', 'Sub'), settings)
    const subText = rec.texts.find((t) => t.text === 'Sub')
    expect(subText).toBeDefined()
    expect(subText!.font).toContain('600')
    expect(subText!.alpha).toBe(1)
    expect(subText!.color).toBe('#111114')
  })

  it('places the box flush with the text column, like the accent bar', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head', 'Sub'), settings)
    const subBand = rec.bands.find((b) => b.color === '#ffe27a')!
    expect(subBand.left).toBeCloseTo(boxLeft, 6)
  })

  it('keeps the plain style translucent at alpha 0.72 and weight 400, unchanged from before the feature', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head', 'Sub'), {
      ...settings,
      subheadStyle: 'plain',
    })
    const subText = rec.texts.find((t) => t.text === 'Sub')!
    expect(subText.alpha).toBe(0.72)
    expect(subText.font).toContain('400')
    expect(rec.bands.some((b) => b.color === '#ffe27a')).toBe(false)
  })

  it('falls back to the plain look when there are no highlights', () => {
    const rec = recorder()
    drawTextBlock(rec.ctx, W, 250, 1000, layout, screen('Head', 'Sub'), { ...settings, highlights: [] })
    const subText = rec.texts.find((t) => t.text === 'Sub')!
    expect(subText.alpha).toBe(0.72)
    expect(rec.bands).toHaveLength(0)
  })
})

describe('headlineBaseSize', () => {
  it('matches the size layoutText starts its own shrink from', () => {
    const size = headlineBaseSize(1000, DEFAULT_SETTINGS)
    const block = layoutText(measurer(0), screen(''), DEFAULT_SETTINGS, 10_000, 10_000, 1000)
    expect(block.headSize).toBe(size)
  })

  it('scales with headlineScale and the layout textScale, like layoutText does', () => {
    const settings = { ...DEFAULT_SETTINGS, headlineScale: 1.5 }
    expect(headlineBaseSize(1000, settings, 2)).toBe(1000 * 0.04 * 1.5 * 2)
  })
})

/** A canvas stand-in whose measured width scales with the px size baked into `ctx.font`, so a
 *  shrink loop actually narrows what it measures — unlike `measurer`'s fixed 10px-per-char. */
const sizeAware = (perCharAt10px = 10): TextMeasurer => {
  const m: TextMeasurer = {
    font: '',
    letterSpacing: '0px',
    measureText: (text: string) => {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(m.font)?.[1] ?? 10)
      return { width: text.length * perCharAt10px * (px / 10) }
    },
  }
  return m
}

describe('layoutList', () => {
  const H = 1000
  const settings = DEFAULT_SETTINGS

  it('keeps the cap size when every row already fits', () => {
    const block = layoutList(measurer(10), ['One', 'Two'], settings, 1000, 1000, H, 40)
    expect(block).toMatchObject({ size: 40, fits: true })
    expect(block.lines).toHaveLength(2)
  })

  it('shrinks until the widest row fits maxWidth', () => {
    const block = layoutList(sizeAware(), ['A very long list entry indeed'], settings, 600, 1000, H, 40)
    expect(block.size).toBeLessThan(40)
    expect(block.fits).toBe(true)
    expect(block.lines[0].width).toBeLessThanOrEqual(600)
  })

  it('shrinks until every stacked row fits maxHeight', () => {
    const entries = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']
    const block = layoutList(measurer(10), entries, settings, 10_000, 200, H, 40)
    expect(block.size).toBeLessThan(40)
    expect(block.size * entries.length * LIST_LH).toBeLessThanOrEqual(200 + 1e-6)
  })

  it('reports no fit once the shrink hits the same floor the headline uses', () => {
    const block = layoutList(measurer(10), ['Way too wide for this box'], settings, 5, 5, H, 40)
    expect(block.fits).toBe(false)
  })

  it('never wraps a row across two lines — one Line per entry, however wide', () => {
    const block = layoutList(measurer(10), ['A very long list entry indeed'], settings, 5, 10_000, H, 40)
    expect(block.lines).toHaveLength(1)
  })

  it('parses `*star*` markup in each row the same way the headline does', () => {
    const block = layoutList(measurer(10), ['Save *money* fast'], settings, 10_000, 10_000, H, 40)
    expect(block.lines[0].words.some((w) => w.span >= 0)).toBe(true)
  })
})

describe('measureListBlock', () => {
  const H = 1000
  const settings = DEFAULT_SETTINGS

  it('is null for a layout with no list band', () => {
    const layout = getLayout('text-top')
    const s = { ...screen('Head'), list: ['One', 'Two'] }
    expect(measureListBlock(measurer(10), 500, 500, H, layout, s, settings, 40)).toBeNull()
  })

  it('is null when the screen carries no list', () => {
    const layout = getLayout('feature-wall')
    expect(measureListBlock(measurer(10), 500, 500, H, layout, screen('Head'), settings, 40)).toBeNull()
  })

  it('measures the rows inside the list band width', () => {
    const layout = getLayout('feature-wall')
    const s = { ...screen('Head'), list: ['One', 'Two', 'Three'] }
    const block = measureListBlock(measurer(10), 500, 500, H, layout, s, settings, 40)
    expect(block).not.toBeNull()
    expect(block!.lines).toHaveLength(3)
  })
})

describe('drawListBlock', () => {
  const H = 1000
  const W = 500
  const layout = getLayout('feature-wall')
  const settings = { ...DEFAULT_SETTINGS, textAlign: 'left' as const }

  it('draws nothing when the screen carries no list', () => {
    const rec = recorder()
    drawListBlock(rec.ctx, W, W, H, layout, screen('Head'), settings, 40)
    expect(rec.texts).toHaveLength(0)
  })

  it('draws one text per row, in order, at headline weight', () => {
    const rec = recorder()
    const s = { ...screen('Head'), list: ['Budget', 'Sparziele'] }
    drawListBlock(rec.ctx, W, W, H, layout, s, settings, 40)
    expect(rec.texts.map((t) => t.text)).toEqual(['Budget', 'Sparziele'])
    expect(rec.texts.every((t) => t.font.includes('700'))).toBe(true)
  })

  it('draws a marker band for a starred word, like the headline', () => {
    const rec = recorder()
    const s = { ...screen('Head'), list: ['Save *money* fast'] }
    drawListBlock(rec.ctx, W, W, H, layout, s, { ...settings, highlights: ['#ffe27a'] }, 40)
    expect(rec.bands.some((b) => b.color === '#ffe27a')).toBe(true)
  })

  it('draws nothing for a layout with no list band', () => {
    const rec = recorder()
    const s = { ...screen('Head'), list: ['One', 'Two'] }
    drawListBlock(rec.ctx, W, W, H, getLayout('text-top'), s, settings, 40)
    expect(rec.texts).toHaveLength(0)
  })

  it('lays an RTL row out from the right edge of the list box, like the headline', () => {
    const rec = recorder()
    const s = { ...screen('Head'), list: ['ab'], lang: 'ar' }
    drawListBlock(rec.ctx, W, W, H, layout, s, settings, 40)
    expect(rec.state.direction).toBe('rtl')
  })

  it('caps the shared size at capSize, never bigger', () => {
    const rec = recorder()
    const s = { ...screen('Head'), list: ['Hi'] }
    drawListBlock(rec.ctx, W, W, H, layout, s, settings, 40)
    expect(rec.texts[0].font).toContain('40px')
  })
})
