import type { Layout, Screen, Settings } from '../types'
import { fontStackFor, isRtl } from '../presets/scripts'

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
}

/** A headline word with the index of the `*span*` it belongs to (-1 = plain). `glue` marks a
 *  piece that a segmenter split off its neighbour, so no space belongs in front of it. */
export type Word = { text: string; span: number; glue?: boolean }

/** `The list that *feels* like a *notebook.*` → words tagged with their highlight span. */
export function parseMarkup(text: string): Word[] {
  const words: Word[] = []
  const parts = text.split('*')
  parts.forEach((part, i) => {
    // An unmatched trailing star is just dropped rather than highlighting the tail.
    const inSpan = i % 2 === 1 && i < parts.length - 1
    const span = inSpan ? (i - 1) / 2 : -1
    for (const t of part.split(/\s+/)) if (t) words.push({ text: t, span })
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
      out.push({ text: lead + segment, span: word.span, glue: out.length > 0 })
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
  const lines: Line[] = []
  let line: Line = { words: [], widths: [], width: 0 }
  for (const word of words.flatMap((w) => pieces(w, lang))) {
    const ww = ctx.measureText(word.text).width
    const gap = line.words.length && !word.glue ? space : 0
    const next = line.width + gap + ww
    if (line.words.length && next > maxWidth) {
      lines.push(line)
      line = { words: [{ ...word, glue: false }], widths: [ww], width: ww }
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
  headLines: Line[]
  subLines: Line[]
  gap: number
}

export const HEAD_LH = 1.14
export const SUB_LH = 1.4

export function setHeadFont(ctx: TextMeasurer, size: number, settings: Settings, lang?: string) {
  ctx.font = `700 ${size}px ${fontStackFor(settings.fontId, lang)}`
  ctx.letterSpacing = `${size * settings.headlineTracking}px`
}

export function setSubFont(ctx: TextMeasurer, size: number, settings: Settings, lang?: string) {
  ctx.font = `400 ${size}px ${fontStackFor(settings.fontId, lang)}`
  ctx.letterSpacing = '0px'
}

/** Total height of a laid-out block, headline + gap + subhead. */
export const blockHeight = ({ headLines, headSize, subLines, subSize, gap }: TextLayout) =>
  headLines.length * headSize * HEAD_LH + (subLines.length ? gap + subLines.length * subSize * SUB_LH : 0)

export function layoutText(
  ctx: TextMeasurer,
  screen: Screen,
  settings: Settings,
  maxWidth: number,
  maxHeight: number,
  h: number,
): TextLayout {
  let headSize = h * 0.04 * settings.headlineScale
  let subSize = h * 0.0205 * settings.subheadScale
  const gap = h * 0.018
  const headWords = parseMarkup(screen.headline)
  const subWords = parseMarkup(screen.subhead)

  // Shrink until it fits: overflowing into the device is worse than smaller type.
  for (let i = 0; i < 30; i++) {
    setHeadFont(ctx, headSize, settings, screen.lang)
    const headLines = wrap(ctx, headWords, maxWidth, screen.lang)
    setSubFont(ctx, subSize, settings, screen.lang)
    const subLines = wrap(ctx, subWords, maxWidth, screen.lang)
    const candidate = { headSize, subSize, headLines, subLines, gap }
    if (blockHeight(candidate) <= maxHeight || headSize < h * 0.014) return candidate
    headSize *= 0.94
    subSize *= 0.94
  }
  return { headSize, subSize, headLines: [], subLines: [], gap }
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

  line.words.forEach((word, i) => ctx.fillText(word.text, xs[i], y))
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
  if (!layout.text || (!screen.headline && !screen.subhead)) return

  // The text box: the tile minus padding by default, or wherever the layout puts it.
  const boxLeft = layout.text.left !== undefined ? W * layout.text.left : tileW * layout.padX
  const maxWidth = layout.text.width !== undefined ? W * layout.text.width : tileW * (1 - layout.padX * 2)
  const bandTop = layout.text.top * h
  const bandHeight = layout.text.height * h
  const block = layoutText(ctx, screen, settings, maxWidth, availableTextHeight(layout, h), h)
  const { headSize, subSize, headLines, subLines, gap } = block

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
  ctx.textBaseline = 'top'
  ctx.fillStyle = settings.textColor

  setHeadFont(ctx, headSize, settings, screen.lang)
  for (const line of headLines) {
    drawLine(ctx, line, startX(line.width), y, headSize, settings.highlights, rtl)
    y += headSize * HEAD_LH
  }
  if (subLines.length) {
    y += gap
    ctx.globalAlpha = 0.72
    setSubFont(ctx, subSize, settings, screen.lang)
    for (const line of subLines) {
      drawLine(ctx, line, startX(line.width), y, subSize, [], rtl)
      y += subSize * SUB_LH
    }
  }
  ctx.restore()
}
