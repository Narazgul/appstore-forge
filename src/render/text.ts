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
 *  piece that a segmenter split off its neighbour, so no space belongs in front of it. `break`
 *  marks a word that starts a forced line, from a `\n` in the copy. */
export type Word = { text: string; span: number; glue?: boolean; break?: boolean }

/** `The list that *feels* like a *notebook.*` → words tagged with their highlight span. A `\n`
 *  forces a line break at that point; markup spans still count across it (`pieces` and `wrap`
 *  carry the flag through). */
export function parseMarkup(text: string): Word[] {
  const words: Word[] = []
  const parts = text.replace(/\r\n?/g, '\n').split('*')
  let pendingBreak = false
  parts.forEach((part, i) => {
    // An unmatched trailing star is just dropped rather than highlighting the tail.
    const inSpan = i % 2 === 1 && i < parts.length - 1
    const span = inSpan ? (i - 1) / 2 : -1
    part.split(/\n+/).forEach((segment, si) => {
      if (si > 0) pendingBreak = true
      for (const t of segment.split(/\s+/)) {
        if (!t) continue
        words.push(pendingBreak && words.length > 0 ? { text: t, span, break: true } : { text: t, span })
        pendingBreak = false
      }
    })
  })
  return words
}

export const stripMarkup = (text: string) =>
  parseMarkup(text)
    .map((w) => w.text)
    .join(' ')

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
      out.push({
        text: lead + segment,
        span: word.span,
        glue: out.length > 0,
        break: out.length === 0 && !!word.break,
      })
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
      // A marker band split over two lines reads as two bands, so the earlier words of the
      // span travel down with it — unless the span is too wide to sit on one line anyway.
      let take = 0
      if (word.span >= 0 && spanWidth(word.span) <= maxWidth) {
        while (take < line.words.length - 1 && line.words[line.words.length - 1 - take].span === word.span)
          take++
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
  let headSize = h * 0.04 * settings.headlineScale * textScale
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
    if (headSize < h * 0.014) return { ...candidate, fits: false }
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

/** Draw one line of words at `y` (top of the em box), with marker bands under starred spans. */
function drawLine(
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

/** The text box: the tile minus padding by default, or wherever the layout puts it. */
const textBox = (layout: Layout, W: number, tileW: number) => ({
  left: layout.text!.left !== undefined ? W * layout.text!.left : tileW * layout.padX,
  maxWidth: layout.text!.width !== undefined ? W * layout.text!.width : tileW * (1 - layout.padX * 2),
})

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

export function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  W: number,
  tileW: number,
  h: number,
  layout: Layout,
  screen: Screen,
  settings: Settings,
) {
  if (!layout.text || (!screen.headline && !screen.subhead && !screen.eyebrow)) return

  const { left: boxLeft, maxWidth } = textBox(layout, W, tileW)
  const bandTop = layout.text.top * h
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

  let y = bandTop + (bandHeight - blockHeight(block)) / 2
  // In an RTL script the "left" alignment is the right edge of the box.
  const rtl = isRtl(screen.lang)
  const startX = (lineWidth: number) =>
    settings.textAlign === 'left'
      ? rtl
        ? boxLeft + maxWidth - lineWidth
        : boxLeft
      : boxLeft + (maxWidth - lineWidth) / 2

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
