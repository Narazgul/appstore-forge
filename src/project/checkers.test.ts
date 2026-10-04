import { createCanvas } from '@napi-rs/canvas'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerFonts } from '../../cli/fonts'
import { AA_LARGE_TEXT } from '../lib/contrast'
import { headlineFitsChecker, worstBackdropContrast, type ContextFactory } from './checkers'
import type { Project } from './types'

const skia: ContextFactory = (w, h) =>
  createCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D
beforeAll(() => registerFonts())

const project = (headline = 'Hi'): Project => ({
  set: {
    version: 1,
    id: 'default',
    targets: [
      { id: 'appstore', sizeId: 'iphone-6-9', deviceId: 'iphone-17-pro', out: 'out/{storeLocale}/{n}.png' },
    ],
    locales: [{ id: 'en', store: { appstore: 'en-US' } }],
    sources: 'src/{locale}/{screen}.png',
    settings: {
      textColor: '#ffffff',
      background: { kind: 'solid', color: '#000000', image: { src: 'bg/a.jpg' } },
    },
    slots: [
      { id: 'a', kind: 'screen', screen: 'shot', overrides: {} },
      { id: 'b', kind: 'screen', screen: 'shot', overrides: { textColor: '#000000' } },
    ],
    approval: null,
  },
  copies: { en: { a: { headline, subhead: '' }, b: { headline, subhead: '' } } },
})

const plain = (color: string) => {
  const c = createCanvas(64, 64)
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 64, 64)
  return c as unknown as CanvasImageSource
}

describe('worstBackdropContrast', () => {
  it('reads the headline against the picture, not against the fallback colour', () => {
    const dark = new Map([['bg/a.jpg', plain('#101010')]])
    const light = new Map([['bg/a.jpg', plain('#f0f0f0')]])
    expect(worstBackdropContrast(project(), dark, skia, ['a'])!.ratio).toBeGreaterThan(10)
    const onLight = worstBackdropContrast(project(), light, skia, ['a'])!
    expect(onLight.slotId).toBe('a')
    expect(onLight.ratio).toBeLessThan(AA_LARGE_TEXT)
  })

  it('names the worst tile when none is asked for, and is silent without a loaded picture', () => {
    const light = new Map([['bg/a.jpg', plain('#f0f0f0')]])
    expect(worstBackdropContrast(project(), light, skia)!.slotId).toBe('a')
    expect(worstBackdropContrast(project(), new Map(), skia)).toBeNull()
  })
})

describe('headlineFitsChecker', () => {
  it('fails only for copy that cannot fit above the shrink floor', () => {
    const long = Array.from({ length: 80 }, () => 'overlong').join(' ')
    expect(headlineFitsChecker(project(), skia)('en', 'a')).toBe(true)
    expect(headlineFitsChecker(project(long), skia)('en', 'a')).toBe(false)
  })
})
