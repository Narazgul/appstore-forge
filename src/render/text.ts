import type { Layout, Screen, Settings } from '../types'
import { fontStackFor, isRtl, scriptFontFor } from '../presets/scripts'

/**
 * The text engine: markup parsing, line breaking, auto-shrink, and drawing. Split out of
 * `scene.ts` because it is the one part of the renderer with real logic in it — everything
 * up to `layoutText` is pure measurement and can be exercised without a canvas.
 */

/** The slice of a canvas context the measuring code touches. Narrow on purpose: a test can
 *  supply a stub measurer instead of standing up a real canvas. */
export type TextMeasurer = {
  measureText: (text: string) => { width: number }
  font: string
  letterSpacing: string
  fontVariationSettings?: string
}

/** A headline word with the index of the `*span*` it belongs to (-1 = plain). `glue` marks a
 *  word with no space in front of it: a piece a segmenter split off its neighbour, or text a
 *  star sat against in the copy (`*Söyle*,`, `數位*信封*`). `join` marks glued text that must not
 *  start a line either — punctuation, or the rest of a spaced-script word. `break` marks a word
 *  that starts a forced line, from a `\n` in the copy. */
export type Word = { text: string; span: number; glue?: boolean; join?: boolean; break?: boolean }

/** Scripts written without spaces between words: a line may break at any star boundary there. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u

/** `The list that *feels* like a *notebook.*` → words tagged with their highlight span. A `\n`
 *  forces a line break at that point; markup spans still count across it (`pieces` and `wrap`
 *  carry the flag through). */
export function parseMarkup(text: string): Word[] {
  const words: Word[] = []
  const parts = text.replace(/\r\n?/g, '\n').split('*')
  let pendingBreak = false
  let before = ''
  parts.forEach((part, i) => {
    // An unmatched trailing star is just dropped rather than highlighting the tail.
    const inSpan = i % 2 === 1 && i < parts.length - 1
    const span = inSpan ? (i - 1) / 2 : -1
    const after = part.charAt(0)
    const attached = !!before && !!after && !/\s/.test(before) && !/\s/.test(after)
    const breakable = UNSPACED.test(before) && UNSPACED.test(after)
    let first = true
    part.split(/\n+/).forEach((segment, si) => {
      if (si > 0) pendingBreak = true
      for (const t of segment.split(/\s+/)) {
        if (!t) continue
        const word: Word = { text: t, span }
        if (pendingBreak && words.length > 0) word.break = true
        else if (first && attached && words.length > 0) {
          word.glue = true
          if (!breakable) word.join = true
        }
        words.push(word)
        pendingBreak = false
        first = false
      }
    })
    if (part) before = part.charAt(part.length - 1)
  })
  return words
}

export const stripMarkup = (text: string) =>
  parseMarkup(text)
    .map((w, i) => (i && !w.glue ? ' ' : '') + w.text)
    .join('')

export type Line = { words: Word[]; widths: number[]; width: number }

/**
 * Split a whitespace-free word into segmenter pieces; Latin words come back whole.
 * Punctuation is never a piece of its own — the segmenter reports it separately, but a break
 * in front of it would strand a comma at the start of a CJK line and tear `$9.99` in two.
 */
function pieces(word: Word, lang: string | undefined): Word[] {
  if (!lang || typeof Intl.Segmenter !== 'function') return [word]
  const out: Word[] = []
  let lead = ''
  for (const { segment, isWordLike } of new Intl.Segmenter(lang, { granularity: 'word' }).segment(
    word.text,
  )) {
    if (!segment.trim()) continue
    if (isWordLike) {
      const piece: Word = {
        text: lead + segment,
        span: word.span,
        glue: out.length > 0 || !!word.glue,
        break: out.length === 0 && !!word.break,
      }
      if (out.length === 0 && word.join) piece.join = true
      out.push(piece)
      lead = ''
    } else if (out.length) {
      out[out.length - 1].text += segment
    } else {
      lead += segment
    }
  }
  return out.length > 1 ? out : [word]
}

export function wrap(ctx: TextMeasurer, words: Word[], maxWidth: number, lang?: string): Line[] {
  if (!words.length) return []
  const space = ctx.measureText(' ').width
  const all = words.flatMap((w) => pieces(w, lang))
  const widths = all.map((w) => ctx.measureText(w.text).width)
  const measure = (ws: Word[], wd: number[]) =>
    wd.reduce((sum, width, i) => sum + (i && !ws[i].glue ? space : 0) + width, 0)

  /** A span is one contiguous run, so its whole width is the sum over its pieces. */
  const spanWidth = (span: number) => {
    let total = 0
    let started = false
    for (let i = 0; i < all.length; i++) {
      if (all[i].span !== span) continue
      total += (started && !all[i].glue ? space : 0) + widths[i]
      started = true
    }
    return total
  }

  const lines: Line[] = []
  let line: Line = { words: [], widths: [], width: 0 }
  for (const [i, word] of all.entries()) {
    const ww = widths[i]
    // A hard `\n` in the copy always starts a new line, regardless of width.
    if (word.break && line.words.length) {
      lines.push(line)
      line = { words: [{ ...word, glue: false }], widths: [ww], width: ww }
      continue
    }
    const gap = line.words.length && !word.glue ? space : 0
    const next = line.width + gap + ww
    if (line.words.length && next > maxWidth) {
      // The new line's first word drags down what it cannot be parted from: joined text the
      // word it hangs on, and a marker band the rest of its span, since a band split over two
      // lines reads as two bands (unless the span is too wide for one line anyway).
      const headAt = (n: number) => (n ? line.words[line.words.length - n] : word)
      let take = 0
      while (take < line.words.length - 1) {
        const head = headAt(take)
        const before = line.words[line.words.length - 1 - take]
        const sameSpan = head.span >= 0 && before.span === head.span && spanWidth(head.span) <= maxWidth
        if (!head.join && !sameSpan) break
        take++
      }
      if (headAt(take).join) {
        // Moving the chain would empty this line, so the joined text overflows it instead.
        line.words.push(word)
        line.widths.push(ww)
        line.width = next
        continue
      }
      const moved = line.words.splice(line.words.length - take, take)
      const movedWidths = line.widths.splice(line.widths.length - take, take)
      if (take) line.width = measure(line.words, line.widths)
      lines.push(line)
      const startWords = [...moved, word].map((w, j) => (j === 0 ? { ...w, glue: false } : w))
      const startWidths = [...movedWidths, ww]
      line = { words: startWords, widths: startWidths, width: measure(startWords, startWidths) }
    } else {
      line.words.push(word)
      line.widths.push(ww)
      line.width = next
    }
  }
  lines.push(line)
  return lines
}

/**
 * How tall the text block may grow before it would collide with the device. This is the
 * gap to the device band, not the nominal band height — otherwise turning the size slider
 * up would just trigger the auto-shrink and feel broken.
 */
export function availableTextHeight(layout: Layout, h: number): number {
  if (!layout.text) return 0
  // No device band to leave room for — the text band itself is the limit.
  if (layout.deviceless) return layout.text.height * h
  const textBelowDevice = layout.text.top > layout.device.top
  const limit = textBelowDevice ? 1 - layout.text.top - 0.03 : layout.device.top - layout.text.top - 0.02
  return Math.max(layout.text.height, limit) * h
}

export type TextLayout = {
  headSize: number
  subSize: number
  eyebrowSize: number
  headLines: Line[]
  subLines: Line[]
  /** never wraps — a single `Line` holding the whole (uppercased) eyebrow, or null when there is none */
  eyebrowLine: Line | null
  gap: number
  /** false when the block only "fits" because the shrink hit its floor — the copy is too long */
  fits: boolean
  /** false when the eyebrow, at the size the block settled on, is wider than the box */
  eyebrowFits: boolean
  /** whether `drawTextBlock` draws the accent bar — already resolved from `settings.accentBar` */
  hasAccentBar: boolean
  /** already resolved from `settings.subheadStyle`: 'label' with no highlights falls back here */
  subheadStyle: 'plain' | 'label'
}

/** Baseline below the top of a line's em box, as a fraction of the font size. The engines place
 *  `textBaseline = 'top'` differently for a stack led by a script face, so the line is set on a
 *  fixed baseline instead: Inter's em-box top in the browser. */
export const BASELINE = 0.8

export const HEAD_LH = 1.14
export const SUB_LH = 1.4
export const EYEBROW_LH = 1.2
/** Row spacing for `feature-wall`'s list block — a touch airier than the headline's own lines. */
export const LIST_LH = 1.28
/** The list's shared size is capped at the headline's own base size (before its per-composition
 *  shrink) times this — the list is `feature-wall`'s hero, so it is allowed to read up to 30%
 *  bigger than the headline above it, not merely as its peer. */
export const LIST_CAP_MULT = 1.3
/** Below this fraction of `h` a shrinking block gives up — shared by the headline and the list,
 *  so both report the same "too long" failure at the same absolute size. */
export const MIN_TEXT_SIZE = 0.014
/** The headline's own size before any per-composition shrink — what `layoutText` starts its
 *  shrink loop from, and the basis `feature-wall`'s list caps itself against. */
export const headlineBaseSize = (h: number, settings: Settings, textScale = 1) =>
  h * 0.04 * settings.headlineScale * textScale
/** Gap above the headline, as a multiple of the eyebrow's own size. */
export const EYEBROW_GAP = 0.6
/** Eyebrow size as a fraction of the headline size it sits above. */
export const EYEBROW_SCALE = 0.34

/** Accent bar geometry, em-relative to the headline size it sits above. */
export const ACCENT_BAR_WIDTH = 0.75
export const ACCENT_BAR_THICKNESS = 0.13
/** Gap from the bar's bottom edge to the next line (the eyebrow, or the headline). */
export const ACCENT_BAR_GAP = 0.48

/** `subheadStyle: 'label'` box geometry, em-relative to the subhead size. */
export const LABEL_PAD_X = 0.26
export const LABEL_PAD_Y = 0.365
export const LABEL_RADIUS = 0.22
/** Space between the headline and the first label box, em-relative to the subhead size. */
export const LABEL_GAP = 0.2
/** The label box's own text row, tighter than `SUB_LH` (the plain subhead's line height, which
 *  carries extra leading for stacked lines) — the box's padding supplies the visual air instead. */
export const LABEL_LINE_HEIGHT = 1.0
/** Extra gap between two stacked label boxes, beyond each box's own height. */
export const LABEL_LINE_GAP = 0.3

/** The label box's own height — text row height plus the vertical padding on both sides. Shared
 *  between `blockHeight` (measurement) and `drawTextBlock` (drawing) so they can never disagree. */
export const labelBoxHeight = (subSize: number) => subSize * LABEL_LINE_HEIGHT + subSize * LABEL_PAD_Y * 2

/** Chip pill geometry, em-relative to the chip's own (possibly shrunk) font size. */
export const CHIP_HEIGHT = 1.9
export const CHIP_PAD_X = 0.8
/** Auto-shrink floor, as a fraction of the chip's configured size — below this the text does not
 *  fit and `fitChipText` reports it, the same way `layoutText` reports a headline that does not. */
export const CHIP_SIZE_FLOOR = 0.7

export type ChipFit = { size: number; textWidth: number; fits: boolean }

/**
 * Shrinks a chip's text from `size` down to `CHIP_SIZE_FLOOR` of it until the pill (text plus its
 * own horizontal padding on both sides) fits `maxWidth`. A chip never wraps, so this is `layoutText`'s
 * shrink loop with a single line and a width-only stop condition instead of a block height.
 */
export function fitChipText(
  ctx: TextMeasurer,
  text: string,
  settings: Settings,
  maxWidth: number,
  size: number,
  lang?: string,
): ChipFit {
  const floor = size * CHIP_SIZE_FLOOR
  let current = size
  for (let i = 0; i < 30; i++) {
    setChipFont(ctx, current, settings, lang)
    const textWidth = ctx.measureText(text).width
    if (textWidth + current * CHIP_PAD_X * 2 <= maxWidth) return { size: current, textWidth, fits: true }
    if (current <= floor) return { size: floor, textWidth, fits: false }
    current = Math.max(floor, current * 0.94)
  }
  setChipFont(ctx, floor, settings, lang)
  return { size: floor, textWidth: ctx.measureText(text).width, fits: false }
}

type FontWeight = 400 | 600 | 700

/**
 * Baloo 2, Nunito and Poppins ship only Regular/Bold static files, everywhere. DM Sans, Space
 * Grotesk and Playfair Display are true variable webfonts in the browser (`@fontsource-variable`)
 * but only Regular/Bold static files in the CLI (`cli/fonts.ts` has no variable master for them).
 * None of these six can draw a real 600 identically in both runtimes, so 600 maps to 700 for all
 * of them — the same substitution in the GUI and the CLI — while Inter, the one face that is a
 * true variable master in both places, draws 600 for real.
 */
const STATIC_WEIGHT_FAMILIES = new Set([
  'baloo-2',
  'nunito',
  'dm-sans',
  'poppins',
  'space-grotesk',
  'playfair',
])

function resolveWeight(weight: FontWeight, fontId: string, lang?: string): FontWeight {
  if (weight !== 600) return weight
  // A script language draws with its Noto face regardless of `fontId`, and every bundled Noto
  // face is a true variable master in both the browser and Skia — a real 600 always reaches it.
  if (scriptFontFor(lang)) return 600
  return STATIC_WEIGHT_FAMILIES.has(fontId) ? 700 : 600
}

function setFont(ctx: TextMeasurer, weight: FontWeight, size: number, settings: Settings, lang?: string) {
  const resolved = resolveWeight(weight, settings.fontId, lang)
  ctx.font = `${resolved} ${size}px ${fontStackFor(settings.fontId, lang)}`
  // Skia (the CLI canvas) ignores the weight in `font` for a variable face and draws its default
  // instance; only the axis picks the weight. Browsers have no such property and need none.
  if ('fontVariationSettings' in ctx) ctx.fontVariationSettings = `"wght" ${resolved}`
}

export function setHeadFont(ctx: TextMeasurer, size: number, settings: Settings, lang?: string) {
  setFont(ctx, 700, size, settings, lang)
  ctx.letterSpacing = `${size * settings.headlineTracking}px`
}

export function setSubFont(ctx: TextMeasurer, size: number, settings: Settings, lang?: string) {
  setFont(ctx, 400, size, settings, lang)
  ctx.letterSpacing = '0px'
}

/** Same face as the headline/subhead — an eyebrow gets its own weight and tracking, not a second font. */
export function setEyebrowFont(ctx: TextMeasurer, size: number, settings: Settings, lang?: string) {
  setFont(ctx, 700, size, settings, lang)
  ctx.letterSpacing = `${size * 0.08}px`
}

/** A chip's text: headline weight, no tracking of its own — the pill's colour already does the
 *  work a highlight band does for the headline. */
export function setChipFont(ctx: TextMeasurer, size: number, settings: Settings, lang?: string) {
  setFont(ctx, 700, size, settings, lang)
  ctx.letterSpacing = '0px'
}

/** The `subheadStyle: 'label'` subhead: weight 600, fully opaque, no tracking of its own. */
export function setLabelSubFont(ctx: TextMeasurer, size: number, settings: Settings, lang?: string) {
  setFont(ctx, 600, size, settings, lang)
  ctx.letterSpacing = '0px'
}

/** Total height of a laid-out block: accent bar (if any) + eyebrow (if any) + headline + gap + subhead. */
export const blockHeight = ({
  headLines,
  headSize,
  subLines,
  subSize,
  gap,
  eyebrowLine,
  eyebrowSize,
  hasAccentBar,
  subheadStyle,
}: TextLayout) =>
  (hasAccentBar ? headSize * ACCENT_BAR_THICKNESS + headSize * ACCENT_BAR_GAP : 0) +
  (eyebrowLine ? eyebrowSize * EYEBROW_LH + eyebrowSize * EYEBROW_GAP : 0) +
  headLines.length * headSize * HEAD_LH +
  (subLines.length
    ? (subheadStyle === 'label' ? subSize * LABEL_GAP : gap) +
      (subheadStyle === 'label'
        ? subLines.length * labelBoxHeight(subSize) +
          Math.max(0, subLines.length - 1) * subSize * LABEL_LINE_GAP
        : subLines.length * subSize * SUB_LH)
    : 0)

export function layoutText(
  ctx: TextMeasurer,
  screen: Screen,
  settings: Settings,
  maxWidth: number,
  maxHeight: number,
  h: number,
  /** layout-level multiplier on the base type sizes; default 1 */
  textScale = 1,
): TextLayout {
  let headSize = headlineBaseSize(h, settings, textScale)
  let subSize = h * 0.0205 * settings.subheadScale * textScale
  const gap = h * 0.018
  const headWords = parseMarkup(screen.headline)
  const subWords = parseMarkup(screen.subhead)
  // No markup in the eyebrow: a literal `*` is not a highlight delimiter here.
  const eyebrowText = screen.eyebrow ? screen.eyebrow.toLocaleUpperCase(screen.lang) : ''
  const hasAccentBar = !!settings.accentBar
  // A 'label' box is drawn in highlights[0]; with none to draw it in, it is not a look, it is a
  // missing colour — fall back to plain rather than draw an invisible or wrongly-coloured box.
  const subheadStyle = settings.subheadStyle === 'label' && settings.highlights.length > 0 ? 'label' : 'plain'

  // Shrink until it fits: overflowing into the device is worse than smaller type.
  for (let i = 0; i < 30; i++) {
    setHeadFont(ctx, headSize, settings, screen.lang)
    const headLines = wrap(ctx, headWords, maxWidth, screen.lang)
    // A label line is drawn at its own weight inside a padded box, so it is measured and
    // wrapped the same way, or the words would be spaced for the wrong weight.
    let subLines: Line[]
    if (subheadStyle === 'label') {
      setLabelSubFont(ctx, subSize, settings, screen.lang)
      subLines = wrap(ctx, subWords, maxWidth - subSize * LABEL_PAD_X * 2, screen.lang)
    } else {
      setSubFont(ctx, subSize, settings, screen.lang)
      subLines = wrap(ctx, subWords, maxWidth, screen.lang)
    }
    const eyebrowSize = headSize * EYEBROW_SCALE
    let eyebrowLine: Line | null = null
    if (eyebrowText) {
      setEyebrowFont(ctx, eyebrowSize, settings, screen.lang)
      const width = ctx.measureText(eyebrowText).width
      eyebrowLine = { words: [{ text: eyebrowText, span: -1 }], widths: [width], width }
    }
    const candidate: TextLayout = {
      headSize,
      subSize,
      eyebrowSize,
      headLines,
      subLines,
      eyebrowLine,
      gap,
      fits: true,
      eyebrowFits: !eyebrowLine || eyebrowLine.width <= maxWidth,
      hasAccentBar,
      subheadStyle,
    }
    if (blockHeight(candidate) <= maxHeight) return candidate
    if (headSize < h * MIN_TEXT_SIZE) return { ...candidate, fits: false }
    headSize *= 0.94
    subSize *= 0.94
  }
  return {
    headSize,
    subSize,
    eyebrowSize: headSize * EYEBROW_SCALE,
    headLines: [],
    subLines: [],
    eyebrowLine: null,
    gap,
    fits: false,
    eyebrowFits: true,
    hasAccentBar,
    subheadStyle,
  }
}

/** Draw one line of words at `y` (top of the em box), with marker bands under starred spans.
 *  Exported so a chip — a single line with no markup, no wrapping — can reuse the exact same RTL
 *  and baseline placement as the headline instead of a second, slightly different implementation. */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  line: Line,
  x0: number,
  y: number,
  size: number,
  highlights: string[],
  rtl: boolean,
) {
  const space = ctx.measureText(' ').width
  const xs: number[] = []
  let x = rtl ? x0 + line.width : x0
  line.words.forEach((word, i) => {
    const gap = i === 0 || word.glue ? 0 : space
    if (rtl) {
      x -= gap + line.widths[i]
      xs.push(x)
    } else {
      x += gap
      xs.push(x)
      x += line.widths[i]
    }
  })

  // Marker bands first, one continuous band per run of same-span words, so a highlighted
  // phrase reads as one stroke rather than a row of boxes.
  if (highlights.length) {
    const pad = size * 0.07
    let i = 0
    while (i < line.words.length) {
      const span = line.words[i].span
      let j = i
      while (j + 1 < line.words.length && line.words[j + 1].span === span) j++
      if (span >= 0) {
        const left = Math.min(xs[i], xs[j]) - pad
        const right = Math.max(xs[i] + line.widths[i], xs[j] + line.widths[j]) + pad
        ctx.save()
        ctx.fillStyle = highlights[span % highlights.length]
        ctx.beginPath()
        ctx.roundRect(left, y + size * 0.1, right - left, size * 0.98, size * 0.07)
        ctx.fill()
        ctx.restore()
      }
      i = j + 1
    }
  }

  line.words.forEach((word, i) => ctx.fillText(word.text, xs[i], y + size * BASELINE))
}

/** A band's box: the tile minus padding by default, or wherever the band's own `left`/`width`
 *  puts it — the convention `layout.text` and `layout.list` both follow. */
const bandBox = (band: { left?: number; width?: number }, layout: Layout, W: number, tileW: number) => ({
  left: band.left !== undefined ? W * band.left : tileW * layout.padX,
  maxWidth: band.width !== undefined ? W * band.width : tileW * (1 - layout.padX * 2),
})
const textBox = (layout: Layout, W: number, tileW: number) => bandBox(layout.text!, layout, W, tileW)
const listBox = (layout: Layout, W: number, tileW: number) => bandBox(layout.list!, layout, W, tileW)

/**
 * The measurement `drawTextBlock` does, without drawing. The CLI runs it up front so copy
 * that only "fits" by shrinking past the floor aborts the render instead of shipping tiny.
 * Returns null for a composition that carries no copy.
 */
export function measureTextBlock(
  ctx: TextMeasurer,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
): TextLayout | null {
  if (!layout.text || (!screen.headline && !screen.subhead && !screen.eyebrow)) return null
  const { maxWidth } = textBox(layout, W, tileW)
  return layoutText(ctx, screen, settings, maxWidth, availableTextHeight(layout, h), h, layout.textScale)
}

/** A move of a whole block in pixels — `Settings.textOffset` already multiplied out. Absent = none. */
export type Shift = { x: number; y: number }

/** Where a line of `lineWidth` starts in its box: the one definition of `textAlign`, shared by the
 *  text block, the list and their measured bounds. In an RTL script "left" is the box's right edge. */
const alignedStart =
  (align: Settings['textAlign'], rtl: boolean, boxLeft: number, maxWidth: number) => (lineWidth: number) =>
    align === 'left' ? (rtl ? boxLeft + maxWidth - lineWidth : boxLeft) : boxLeft + (maxWidth - lineWidth) / 2

type PlacedTextBlock = {
  block: TextLayout
  /** top of the block's first row (the accent bar, the eyebrow or the headline) */
  top: number
  rtl: boolean
  startX: (lineWidth: number) => number
}

/** The text block laid out and placed in its band, shifted by `shift` — what `drawTextBlock`
 *  draws and `textBlockBox` measures, so the editor's selection frame can never drift from it. */
function placeTextBlock(
  ctx: TextMeasurer,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
  shift?: Shift,
): PlacedTextBlock | null {
  if (!layout.text || (!screen.headline && !screen.subhead && !screen.eyebrow)) return null
  const { left, maxWidth } = textBox(layout, W, tileW)
  const boxLeft = shift ? left + shift.x : left
  const bandTop = shift ? layout.text.top * h + shift.y : layout.text.top * h
  const bandHeight = layout.text.height * h
  const block = layoutText(
    ctx,
    screen,
    settings,
    maxWidth,
    availableTextHeight(layout, h),
    h,
    layout.textScale,
  )
  const rtl = isRtl(screen.lang)
  return {
    block,
    top: bandTop + (bandHeight - blockHeight(block)) / 2,
    rtl,
    startX: alignedStart(settings.textAlign, rtl, boxLeft, maxWidth),
  }
}

/** Axis-aligned bounds of everything `drawTextBlock` inks, in canvas pixels; null when it draws nothing. */
export type BlockBox = { x: number; y: number; w: number; h: number }

const spanBox = (
  placed: { startX: (w: number) => number },
  widths: number[],
  top: number,
  height: number,
) => {
  const lefts = widths.map((width) => placed.startX(width))
  const left = Math.min(...lefts)
  const right = Math.max(...lefts.map((l, i) => l + widths[i]))
  return { x: left, y: top, w: right - left, h: height }
}

/**
 * The text block's box: from the top of its first row to the bottom of its last, across the
 * widest row (the accent bar, the eyebrow, each headline line, each subhead line or label box).
 * Never used for drawing — only by the editor to hit-test and frame the copy.
 */
export function textBlockBox(
  ctx: TextMeasurer,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
  shift?: Shift,
): BlockBox | null {
  const placed = placeTextBlock(ctx, W, tileW, h, layout, screen, settings, shift)
  if (!placed) return null
  const { block } = placed
  const labelPad = block.subSize * LABEL_PAD_X * 2
  const widths = [
    ...(block.hasAccentBar ? [block.headSize * ACCENT_BAR_WIDTH] : []),
    ...(block.eyebrowLine ? [block.eyebrowLine.width] : []),
    ...block.headLines.map((l) => l.width),
    ...block.subLines.map((l) => (block.subheadStyle === 'label' ? l.width + labelPad : l.width)),
  ]
  if (!widths.length) return null
  return spanBox(placed, widths, placed.top, blockHeight(block))
}

export function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
  shift?: Shift,
) {
  const placed = placeTextBlock(ctx, W, tileW, h, layout, screen, settings, shift)
  if (!placed) return
  const { block, rtl, startX } = placed
  const {
    headSize,
    subSize,
    headLines,
    subLines,
    gap,
    eyebrowLine,
    eyebrowSize,
    hasAccentBar,
    subheadStyle,
  } = block

  let y = placed.top

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // The words are placed by hand; `direction` is what makes the engine shape and order the
  // glyphs inside one word right to left.
  ctx.direction = rtl ? 'rtl' : 'ltr'

  if (hasAccentBar && settings.accentBar) {
    const barWidth = headSize * ACCENT_BAR_WIDTH
    const barThickness = headSize * ACCENT_BAR_THICKNESS
    ctx.save()
    ctx.fillStyle = settings.accentBar
    ctx.beginPath()
    ctx.roundRect(startX(barWidth), y, barWidth, barThickness, barThickness / 2)
    ctx.fill()
    ctx.restore()
    y += barThickness + headSize * ACCENT_BAR_GAP
  }

  if (eyebrowLine) {
    ctx.fillStyle = settings.eyebrowColor ?? settings.textColor
    setEyebrowFont(ctx, eyebrowSize, settings, screen.lang)
    drawLine(ctx, eyebrowLine, startX(eyebrowLine.width), y, eyebrowSize, [], rtl)
    y += eyebrowSize * EYEBROW_LH + eyebrowSize * EYEBROW_GAP
  }

  ctx.fillStyle = settings.textColor
  setHeadFont(ctx, headSize, settings, screen.lang)
  for (const line of headLines) {
    drawLine(ctx, line, startX(line.width), y, headSize, settings.highlights, rtl)
    y += headSize * HEAD_LH
  }
  if (subLines.length) {
    y += subheadStyle === 'label' ? subSize * LABEL_GAP : gap
    if (subheadStyle === 'label') {
      const padX = subSize * LABEL_PAD_X
      const padY = subSize * LABEL_PAD_Y
      const boxH = labelBoxHeight(subSize)
      setLabelSubFont(ctx, subSize, settings, screen.lang)
      for (const line of subLines) {
        const boxWidth = line.width + padX * 2
        const boxX = startX(boxWidth)
        ctx.save()
        ctx.fillStyle = settings.highlights[0]
        ctx.beginPath()
        ctx.roundRect(boxX, y, boxWidth, boxH, subSize * LABEL_RADIUS)
        ctx.fill()
        ctx.restore()
        ctx.fillStyle = settings.textColor
        drawLine(ctx, line, boxX + padX, y + padY, subSize, [], rtl)
        y += boxH + subSize * LABEL_LINE_GAP
      }
    } else {
      ctx.globalAlpha = 0.72
      setSubFont(ctx, subSize, settings, screen.lang)
      for (const line of subLines) {
        drawLine(ctx, line, startX(line.width), y, subSize, [], rtl)
        y += subSize * SUB_LH
      }
    }
  }
  ctx.restore()
}

export type ListLayout = {
  size: number
  /** one already-wrapped line per entry — an entry never wraps, it only shrinks */
  lines: Line[]
  /** false when the shrink hit the floor and a row still overflows its band */
  fits: boolean
}

/**
 * `feature-wall`'s list: one shared size for every row — the headline's own weight and markup,
 * never wrapped — the largest that keeps each row inside `maxWidth` and every row stacked inside
 * `maxHeight`, capped at `capSize`. Shrinks the same way `layoutText` does, down to the same floor,
 * so a list that cannot fit fails exactly like a headline that cannot.
 */
export function layoutList(
  ctx: TextMeasurer,
  entries: string[],
  settings: Settings,
  maxWidth: number,
  maxHeight: number,
  h: number,
  capSize: number,
  lang?: string,
): ListLayout {
  let size = capSize
  for (let i = 0; i < 30; i++) {
    setHeadFont(ctx, size, settings, lang)
    // Each entry is validated single-line copy: `wrap` never needs to break it, only measure it.
    const lines = entries.map(
      (entry) =>
        wrap(ctx, parseMarkup(entry), Number.POSITIVE_INFINITY, lang)[0] ?? {
          words: [],
          widths: [],
          width: 0,
        },
    )
    const fitsWidth = lines.every((line) => line.width <= maxWidth)
    const fitsHeight = lines.length * size * LIST_LH <= maxHeight
    if (fitsWidth && fitsHeight) return { size, lines, fits: true }
    if (size < h * MIN_TEXT_SIZE) return { size, lines, fits: false }
    size *= 0.94
  }
  return { size, lines: [], fits: false }
}

/** The measurement `drawListBlock` does, without drawing — the CLI's fit check. Returns null for
 *  a composition with no list band or a screen carrying no list. */
export function measureListBlock(
  ctx: TextMeasurer,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
  capSize: number,
): ListLayout | null {
  if (!layout.list || !screen.list?.length) return null
  const { maxWidth } = listBox(layout, W, tileW)
  return layoutList(ctx, screen.list, settings, maxWidth, layout.list.height * h, h, capSize, screen.lang)
}

/** Draws `feature-wall`'s list band, centred in it exactly like the headline is centred in its
 *  own band. Weight, markup and RTL/alignment all follow the headline's own rules — reusing
 *  `parseMarkup`/`wrap`/`drawLine` is what keeps them identical rather than a second definition
 *  of what a marker band or an RTL line looks like. */
type PlacedList = {
  size: number
  lines: Line[]
  top: number
  rtl: boolean
  startX: (lineWidth: number) => number
}

/** The list laid out and placed in its band, shifted by `shift` — `drawListBlock` and
 *  `listBlockBox` share it, exactly like `placeTextBlock`. */
function placeListBlock(
  ctx: TextMeasurer,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
  capSize: number,
  shift?: Shift,
): PlacedList | null {
  if (!layout.list || !screen.list?.length) return null
  const { left, maxWidth } = listBox(layout, W, tileW)
  const boxLeft = shift ? left + shift.x : left
  const bandTop = shift ? layout.list.top * h + shift.y : layout.list.top * h
  const bandHeight = layout.list.height * h
  const { size, lines } = layoutList(
    ctx,
    screen.list,
    settings,
    maxWidth,
    bandHeight,
    h,
    capSize,
    screen.lang,
  )
  const rtl = isRtl(screen.lang)
  return {
    size,
    lines,
    top: bandTop + (bandHeight - lines.length * size * LIST_LH) / 2,
    rtl,
    startX: alignedStart(settings.textAlign, rtl, boxLeft, maxWidth),
  }
}

/** The list's box, same idea as `textBlockBox`; null when the composition draws no list. */
export function listBlockBox(
  ctx: TextMeasurer,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
  capSize: number,
  shift?: Shift,
): BlockBox | null {
  const placed = placeListBlock(ctx, W, tileW, h, layout, screen, settings, capSize, shift)
  if (!placed || !placed.lines.length) return null
  const widths = placed.lines.map((l) => l.width)
  return spanBox(placed, widths, placed.top, placed.lines.length * placed.size * LIST_LH)
}

export function drawListBlock(
  ctx: CanvasRenderingContext2D,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
  capSize: number,
  shift?: Shift,
) {
  const placed = placeListBlock(ctx, W, tileW, h, layout, screen, settings, capSize, shift)
  if (!placed) return
  const { size, lines, rtl, startX } = placed

  let y = placed.top

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.fillStyle = settings.textColor
  setHeadFont(ctx, size, settings, screen.lang)
  for (const line of lines) {
    drawLine(ctx, line, startX(line.width), y, size, settings.highlights, rtl)
    y += size * LIST_LH
  }
  ctx.restore()
}
