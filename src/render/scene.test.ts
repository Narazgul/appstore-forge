import { describe, expect, it } from 'vitest'
import { applyShadow, blobPoints, drawShape, drawSticker, type Box } from './frames'
import { composeDevices, mosaicCells, renderScene, sceneSpan, textFloor } from './scene'
import { CHIP_HEIGHT, CHIP_PAD_X } from './text'
import { getLayout } from '../presets/layouts'
import { POSITIONS, getPosition } from '../presets/positions'
import { DEFAULT_SETTINGS } from '../store'
import type { ChipElement, Screen, SceneElement } from '../types'

const TILE = { w: 1320, h: 2868 }
const ASPECT = 0.46
const screen = (overrides: Screen['overrides'] = {}): Screen => ({
  id: 'test',
  headline: 'Head',
  subhead: '',
  imageId: null,
  overrides,
})

/**
 * A canvas that records instead of painting: every method is a no-op that logs its call, every
 * property assignment is remembered. Enough for renderScene, and it makes the draw calls
 * assertable — which is the only way to see that a frameless placement skipped the device body.
 */
/** `fillStyle` at the moment of the call — read-only history, since `save`/`restore` are no-ops
 *  here and only the final property value would otherwise be observable. */
function recorder() {
  const calls: { fn: string; args: unknown[]; fillStyle: unknown }[] = []
  const props: Record<string, unknown> = {}
  const ctx = new Proxy(props, {
    get(target, prop) {
      const key = String(prop)
      if (key in target) return target[key]
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10 })
      if (key === 'createLinearGradient') return () => ({ addColorStop: () => undefined })
      return (...args: unknown[]) => {
        calls.push({ fn: key, args, fillStyle: target.fillStyle })
      }
    },
    set(target, prop, value) {
      target[String(prop)] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, props }
}

const fakeImage = (w: number, h: number) =>
  ({ naturalWidth: w, naturalHeight: h }) as unknown as CanvasImageSource

const drawn = (calls: { fn: string; args: unknown[] }[]) => calls.filter((c) => c.fn === 'drawImage')

describe('composeDevices', () => {
  it('emits one box per placement in the arrangement', () => {
    const boxes = composeDevices(getLayout('duo'), 'duo', TILE.w, TILE.h, ASPECT, 1, 0)
    expect(boxes).toHaveLength(getPosition('duo').placements.length)
  })

  it('preserves the device aspect ratio on every box', () => {
    for (const { box } of composeDevices(getLayout('hero'), 'center', TILE.w, TILE.h, ASPECT, 1, 0)) {
      expect(box.w / box.h).toBeCloseTo(ASPECT, 5)
    }
  })

  it('centres a single frame in its band', () => {
    const layout = getLayout('text-top')
    const [{ box }] = composeDevices(layout, 'center', TILE.w, TILE.h, ASPECT, 1, 0)
    expect(box.x + box.w / 2).toBeCloseTo(TILE.w / 2, 5)
  })

  it('scales the frame by deviceScale about the same centre', () => {
    const layout = getLayout('text-top')
    const [a] = composeDevices(layout, 'center', TILE.w, TILE.h, ASPECT, 1, 0)
    const [b] = composeDevices(layout, 'center', TILE.w, TILE.h, ASPECT, 0.5, 0)
    expect(b.box.w).toBeCloseTo(a.box.w * 0.5, 5)
    expect(b.box.x + b.box.w / 2).toBeCloseTo(a.box.x + a.box.w / 2, 5)
  })

  it('adds the global tilt on top of each placement rotation', () => {
    const layout = getLayout('duo')
    const plain = composeDevices(layout, 'duo-tilt', TILE.w, TILE.h, ASPECT, 1, 0)
    const tilted = composeDevices(layout, 'duo-tilt', TILE.w, TILE.h, ASPECT, 1, 7)
    tilted.forEach((d, i) => expect(d.angle).toBeCloseTo(plain[i].angle + 7, 5))
  })

  it('lays a span-2 composition out across two tiles', () => {
    const layout = getLayout('panorama')
    const boxes = composeDevices(layout, 'lean', TILE.w, TILE.h, ASPECT, 1, 0)
    const right = Math.max(...boxes.map((b) => b.box.x + b.box.w))
    expect(layout.span).toBe(2)
    expect(right).toBeGreaterThan(TILE.w)
  })

  it('honours a layout that fixes the frame width instead of fitting the band', () => {
    const layout = getLayout('hero')
    const [{ box }] = composeDevices(layout, 'center', TILE.w, TILE.h, ASPECT, 1, 0)
    expect(box.w).toBeCloseTo(TILE.w * layout.device.width!, 5)
  })

  it('pushes a fixed-width device below minTop instead of letting it climb into the text', () => {
    const layout = getLayout('hero')
    const tall = { w: 1080, h: 1920 }
    const [{ box }] = composeDevices(layout, 'center', tall.w, tall.h, ASPECT, 1, 0, tall.h * 0.3)
    expect(box.y).toBeGreaterThanOrEqual(tall.h * 0.3)
  })

  it('does not move a device that already sits below minTop', () => {
    const layout = getLayout('text-top')
    const [a] = composeDevices(layout, 'center', TILE.w, TILE.h, ASPECT, 1, 0)
    const [b] = composeDevices(layout, 'center', TILE.w, TILE.h, ASPECT, 1, 0, 10)
    expect(b.box).toEqual(a.box)
  })
})

describe('textFloor', () => {
  it('clears the bottom of a headline that sits above the device', () => {
    const layout = getLayout('hero')
    const band = layout.text!
    expect(textFloor(layout, TILE.h)).toBeCloseTo(TILE.h * (band.top + band.height) + TILE.h * 0.02, 5)
  })

  it('yields no floor when the copy sits below the device', () => {
    expect(textFloor(getLayout('text-bottom'), TILE.h)).toBeUndefined()
  })

  it('yields no floor for a layout without copy', () => {
    expect(textFloor(getLayout('centered'), TILE.h)).toBeUndefined()
  })

  it('leaves a text-below composition where the layout put it', () => {
    const layout = getLayout('text-bottom')
    const [plain] = composeDevices(layout, 'center', TILE.w, TILE.h, ASPECT, 1, 0)
    const [floored] = composeDevices(
      layout,
      'center',
      TILE.w,
      TILE.h,
      ASPECT,
      1,
      0,
      textFloor(layout, TILE.h),
    )
    expect(floored.box).toEqual(plain.box)
  })
})

describe('sceneSpan', () => {
  it('is one tile for an ordinary layout', () => {
    expect(sceneSpan(screen(), DEFAULT_SETTINGS)).toBe(1)
  })

  it('is two tiles for a panorama', () => {
    expect(sceneSpan(screen(), { ...DEFAULT_SETTINGS, layout: 'panorama' })).toBe(2)
  })

  it('reads the screen override, not the global layout', () => {
    expect(sceneSpan(screen({ layout: 'panorama' }), DEFAULT_SETTINGS)).toBe(2)
  })
})

describe('arrangements', () => {
  it('every arrangement places at least one device', () => {
    for (const pos of POSITIONS) expect(pos.placements.length).toBeGreaterThan(0)
  })

  it('pairs the screen with a frameless artwork in duo-artwork', () => {
    const [self, art] = getPosition('duo-artwork').placements
    expect(self.source).toBe('self')
    expect(self.frameless).toBeUndefined()
    expect(art).toMatchObject({ source: 'artwork', frameless: true })
    expect(art.dx).toBeGreaterThan(0)
    expect(self.dx).toBeLessThan(0)
  })

  it('tilts both frames of duo-artwork-tilt the same way', () => {
    const rotations = getPosition('duo-artwork-tilt').placements.map((p) => p.rotate)
    expect(rotations).toEqual([-6, -6])
  })

  it('carries the frameless flag into the composed boxes', () => {
    const boxes = composeDevices(getLayout('duo'), 'duo-artwork', TILE.w, TILE.h, ASPECT, 1, 0)
    expect(boxes.map((b) => b.frameless)).toEqual([false, true])
    expect(
      composeDevices(getLayout('duo'), 'duo', TILE.w, TILE.h, ASPECT, 1, 0).every((b) => !b.frameless),
    ).toBe(true)
  })
})

describe('renderScene with an artwork placement', () => {
  const settings = { ...DEFAULT_SETTINGS, layout: 'duo' as const, positionId: 'duo-artwork' }

  it('contain-fits the artwork into its box without drawing a device around it', () => {
    const { ctx, calls } = recorder()
    const shot = fakeImage(400, 800)
    const art = fakeImage(200, 100)
    renderScene(ctx, TILE.w, TILE.h, screen(), settings, { self: shot, artwork: art })

    const images = drawn(calls)
    expect(images).toHaveLength(2)
    const [, box] = composeDevices(
      getLayout('duo'),
      'duo-artwork',
      TILE.w,
      TILE.h,
      ASPECT,
      settings.deviceScale,
      settings.tilt,
      textFloor(getLayout('duo'), TILE.h),
    )
    const scale = Math.min(box.box.w / 200, box.box.h / 100)
    expect(images[1].args[0]).toBe(art)
    expect(images[1].args[1]).toBeCloseTo(box.box.x + (box.box.w - 200 * scale) / 2, 5)
    expect(images[1].args[2]).toBeCloseTo(box.box.y + (box.box.h - 100 * scale) / 2, 5)
    expect(images[1].args[3]).toBeCloseTo(200 * scale, 5)
    expect(images[1].args[4]).toBeCloseTo(100 * scale, 5)
  })

  it('draws nothing for the artwork rather than falling back to the screenshot', () => {
    const { ctx, calls } = recorder()
    const shot = fakeImage(400, 800)
    renderScene(ctx, TILE.w, TILE.h, screen(), settings, { self: shot, artwork: null })

    const images = drawn(calls)
    expect(images).toHaveLength(1)
    expect(images[0].args[0]).toBe(shot)
  })

  it('leaves an arrangement without artwork placements untouched', () => {
    const { ctx, calls } = recorder()
    const plain = { ...DEFAULT_SETTINGS, layout: 'duo' as const, positionId: 'duo' }
    renderScene(ctx, TILE.w, TILE.h, screen(), plain, {
      self: fakeImage(400, 800),
      next: fakeImage(400, 800),
      artwork: fakeImage(200, 100),
    })
    expect(drawn(calls)).toHaveLength(2)
  })
})

describe('renderScene with an artwork-kind screen', () => {
  it('draws no device at all for a self-only arrangement', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'text-top' as const, positionId: 'center' }
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), kind: 'artwork' }, settings, {
      self: fakeImage(400, 800),
    })
    expect(drawn(calls)).toHaveLength(0)
  })

  it('still draws the slot-level artwork when the arrangement asks for one', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'duo' as const, positionId: 'duo-artwork' }
    const art = fakeImage(200, 100)
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), kind: 'artwork' }, settings, {
      self: fakeImage(400, 800),
      artwork: art,
    })
    const images = drawn(calls)
    expect(images).toHaveLength(1)
    expect(images[0].args[0]).toBe(art)
  })

  it('does not fall back to the screenshot when there is no artwork either', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'duo' as const, positionId: 'duo-artwork' }
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), kind: 'artwork' }, settings, {
      self: fakeImage(400, 800),
      artwork: null,
    })
    expect(drawn(calls)).toHaveLength(0)
  })

  it('still draws stickers and text around the missing device', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'banner-right' as const, positionId: 'center' }
    const el: SceneElement = {
      id: 'e',
      imageId: 'mascot',
      x: 0.2,
      y: 0.5,
      width: 0.3,
      rotate: 0,
      layer: 'front',
      shadow: false,
    }
    const mascot = fakeImage(100, 100)
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), kind: 'artwork', elements: [el] }, settings, {
      elements: { mascot },
    })
    const images = drawn(calls)
    expect(images).toHaveLength(1)
    expect(images[0].args[0]).toBe(mascot)
    expect(calls.some((c) => c.fn === 'fillText')).toBe(true)
  })
})

describe('composeDevices with a deviceless layout', () => {
  it('emits no boxes at all, whatever the arrangement asks for', () => {
    const layout = getLayout('text-only')
    for (const pos of POSITIONS) {
      expect(composeDevices(layout, pos.id, TILE.w, TILE.h, ASPECT, 1, 0)).toEqual([])
    }
  })
})

describe('textFloor for a deviceless layout', () => {
  it('yields no floor — there is no device to clear', () => {
    expect(textFloor(getLayout('text-only'), TILE.h)).toBeUndefined()
    expect(textFloor(getLayout('feature-wall'), TILE.h)).toBeUndefined()
  })
})

describe('renderScene with a deviceless layout', () => {
  it('draws no device and no artwork placement for a screen-kind slot', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'text-only' as const }
    renderScene(ctx, TILE.w, TILE.h, screen(), settings, { self: fakeImage(400, 800) })
    expect(drawn(calls)).toHaveLength(0)
  })

  it('draws no backdrop, even when backdropColor is set', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'text-only' as const, backdropColor: '#eaf2ff' }
    renderScene(ctx, TILE.w, TILE.h, screen(), settings, {})
    // roundRect is the only call that draws a rounded card; with no backdrop and no accent bar
    // or label box in this fixture, nothing should call it.
    expect(calls.some((c) => c.fn === 'roundRect')).toBe(false)
  })

  it('still draws stickers and text around the missing device', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'text-only' as const }
    const el: SceneElement = {
      id: 'e',
      imageId: 'mascot',
      x: 0.5,
      y: 0.5,
      width: 0.3,
      rotate: 0,
      layer: 'front',
      shadow: false,
    }
    const mascot = fakeImage(100, 100)
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), elements: [el] }, settings, { elements: { mascot } })
    const images = drawn(calls)
    expect(images).toHaveLength(1)
    expect(images[0].args[0]).toBe(mascot)
    expect(calls.some((c) => c.fn === 'fillText')).toBe(true)
  })
})

describe('renderScene with a feature-wall list', () => {
  it('draws no device and draws every list row', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'feature-wall' as const }
    const s = { ...screen(), list: ['Budget', 'Sparziele', 'Notgroschen'] }
    renderScene(ctx, TILE.w, TILE.h, s, settings, { self: fakeImage(400, 800) })
    expect(drawn(calls)).toHaveLength(0)
    const texts = calls.filter((c) => c.fn === 'fillText').map((c) => c.args[0])
    for (const entry of s.list) expect(texts).toContain(entry)
  })

  it('draws no list at all when the screen carries none', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'feature-wall' as const }
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), headline: '', subhead: '' }, settings, {})
    expect(calls.some((c) => c.fn === 'fillText')).toBe(false)
  })

  it('leaves an ordinary layout untouched by a list nobody reads there', () => {
    const { ctx, calls } = recorder()
    const settings = { ...DEFAULT_SETTINGS, layout: 'text-top' as const }
    const s = { ...screen(), list: ['One', 'Two'] }
    renderScene(ctx, TILE.w, TILE.h, s, settings, { self: fakeImage(400, 800) })
    const texts = calls.filter((c) => c.fn === 'fillText').map((c) => c.args[0])
    expect(texts).not.toContain('One')
  })
})

describe('drawSticker', () => {
  it('draws the image at exactly the given box, undistorted', () => {
    const { ctx, calls } = recorder()
    const img = fakeImage(200, 100)
    drawSticker(ctx, { x: 10, y: 20, w: 150, h: 75 }, img, false)
    expect(drawn(calls)).toEqual([{ fn: 'drawImage', args: [img, 10, 20, 150, 75] }])
  })

  it('sets a soft drop shadow, sized off the box width, exactly like a device frame', () => {
    const { ctx } = recorder()
    drawSticker(ctx, { x: 0, y: 0, w: 200, h: 100 }, fakeImage(200, 100), true)
    expect(ctx.shadowColor).toBe('rgba(15, 23, 42, 0.30)')
    expect(ctx.shadowBlur).toBeCloseTo(200 * 0.09, 5)
    expect(ctx.shadowOffsetY).toBeCloseTo(200 * 0.035, 5)
  })
})

describe('renderScene with stickers', () => {
  const settings = { ...DEFAULT_SETTINGS, layout: 'text-top' as const, positionId: 'center' }
  const el = (patch: Partial<SceneElement> = {}): SceneElement => ({
    id: 'sticker',
    imageId: 'sticker',
    x: 0.5,
    y: 0.5,
    width: 0.3,
    rotate: 0,
    layer: 'front',
    shadow: false,
    ...patch,
  })

  it('draws a behind sticker before the device and a front sticker after it', () => {
    const device = fakeImage(400, 800)
    const sticker = fakeImage(100, 100)

    const behind = recorder()
    renderScene(behind.ctx, TILE.w, TILE.h, { ...screen(), elements: [el({ layer: 'behind' })] }, settings, {
      self: device,
      elements: { sticker },
    })
    const behindImages = drawn(behind.calls)
    expect(behindImages.map((c) => c.args[0])).toEqual([sticker, device])

    const front = recorder()
    renderScene(front.ctx, TILE.w, TILE.h, { ...screen(), elements: [el({ layer: 'front' })] }, settings, {
      self: device,
      elements: { sticker },
    })
    const frontImages = drawn(front.calls)
    expect(frontImages.map((c) => c.args[0])).toEqual([device, sticker])
  })

  it('keeps the sticker centred regardless of rotation — only the surrounding transform turns', () => {
    const sticker = fakeImage(200, 100)
    const flat = recorder()
    renderScene(flat.ctx, TILE.w, TILE.h, { ...screen(), elements: [el({ rotate: 0 })] }, settings, {
      self: null,
      elements: { sticker },
    })
    const rotated = recorder()
    renderScene(rotated.ctx, TILE.w, TILE.h, { ...screen(), elements: [el({ rotate: 25 })] }, settings, {
      self: null,
      elements: { sticker },
    })
    expect(drawn(rotated.calls)[0].args).toEqual(drawn(flat.calls)[0].args)
  })

  it('draws nothing for a sticker whose image is missing', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), elements: [el()] }, settings, {
      self: null,
      elements: {},
    })
    expect(drawn(calls)).toHaveLength(0)
  })

  it('sizes the sticker from its own width and the image aspect ratio, not a fitted band', () => {
    const sticker = fakeImage(200, 100)
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), elements: [el({ width: 0.4 })] }, settings, {
      self: null,
      elements: { sticker },
    })
    const [call] = drawn(calls)
    const dw = 0.4 * TILE.w
    const dh = (dw * 100) / 200
    expect(call.args.slice(1)).toEqual([0.5 * TILE.w - dw / 2, 0.5 * TILE.h - dh / 2, dw, dh])
  })

  it('positions a sticker against the full composition width, so it can sit across a panorama seam', () => {
    const sticker = fakeImage(100, 100)
    const layout = getLayout('panorama')
    const panorama = { ...DEFAULT_SETTINGS, layout: 'panorama' as const, positionId: 'lean' }
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), elements: [el({ x: 0.75, width: 0.2 })] }, panorama, {
      self: null,
      elements: { sticker },
    })
    const [call] = drawn(calls).filter((c) => c.args[0] === sticker)
    const W = TILE.w * layout.span
    const dw = 0.2 * TILE.w
    expect(call.args[1]).toBeCloseTo(0.75 * W - dw / 2, 5)
  })
})

describe('renderScene with shapes', () => {
  const settings = { ...DEFAULT_SETTINGS, layout: 'text-top' as const, positionId: 'center' }
  const shapeEl = (patch: Partial<SceneElement> = {}): SceneElement => ({
    id: 'kreis',
    shape: 'circle',
    color: '#eaf2ff',
    x: 0.193,
    y: 0.2,
    width: 0.666,
    rotate: 0,
    layer: 'behind',
    ...patch,
  })

  it('draws a filled circle with no source image at all', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), elements: [shapeEl()] }, settings, {})
    expect(calls.some((c) => c.fn === 'ellipse')).toBe(true)
    expect(calls.some((c) => c.fn === 'fill')).toBe(true)
  })

  it('sets fillStyle to the shape color before filling it', () => {
    const { ctx, calls } = recorder()
    // layer 'front' so nothing drawn afterwards (the device, the notch) overwrites fillStyle
    // before this assertion reads it back.
    renderScene(
      ctx,
      TILE.w,
      TILE.h,
      { ...screen(), elements: [shapeEl({ color: '#ff00aa', layer: 'front' })] },
      settings,
      {},
    )
    expect(ctx.fillStyle).toBe('#ff00aa')
    expect(calls.some((c) => c.fn === 'ellipse')).toBe(true)
  })

  it('sizes the circle as a square from its own width, not any image aspect ratio', () => {
    const { ctx, calls } = recorder()
    renderScene(
      ctx,
      TILE.w,
      TILE.h,
      { ...screen(), elements: [shapeEl({ x: 0.5, y: 0.5, width: 0.4 })] },
      settings,
      {},
    )
    const [call] = calls.filter((c) => c.fn === 'ellipse')
    const r = (0.4 * TILE.w) / 2
    expect(call.args).toEqual([0.5 * TILE.w, 0.5 * TILE.h, r, r, 0, 0, Math.PI * 2])
  })

  it('draws a behind shape before the device and a front shape after it', () => {
    const device = fakeImage(400, 800)

    const behind = recorder()
    renderScene(
      behind.ctx,
      TILE.w,
      TILE.h,
      { ...screen(), elements: [shapeEl({ layer: 'behind' })] },
      settings,
      {
        self: device,
      },
    )
    const behindEllipseAt = behind.calls.findIndex((c) => c.fn === 'ellipse')
    const behindDeviceAt = behind.calls.findIndex((c) => c.fn === 'drawImage')
    expect(behindEllipseAt).toBeGreaterThanOrEqual(0)
    expect(behindEllipseAt).toBeLessThan(behindDeviceAt)

    const front = recorder()
    renderScene(
      front.ctx,
      TILE.w,
      TILE.h,
      { ...screen(), elements: [shapeEl({ layer: 'front' })] },
      settings,
      {
        self: device,
      },
    )
    const frontEllipseAt = front.calls.findIndex((c) => c.fn === 'ellipse')
    const frontDeviceAt = front.calls.findIndex((c) => c.fn === 'drawImage')
    expect(frontEllipseAt).toBeGreaterThan(frontDeviceAt)
  })

  it('draws a shape and a sticker in the array order within the same layer', () => {
    const sticker = fakeImage(100, 100)
    const { ctx, calls } = recorder()
    const els: SceneElement[] = [
      shapeEl({ id: 'kreis', layer: 'front' }),
      {
        id: 'sticker',
        imageId: 'sticker',
        x: 0.5,
        y: 0.5,
        width: 0.3,
        rotate: 0,
        layer: 'front',
        shadow: false,
      },
    ]
    renderScene(ctx, TILE.w, TILE.h, { ...screen(), elements: els }, settings, { elements: { sticker } })
    const ellipseAt = calls.findIndex((c) => c.fn === 'ellipse')
    const stickerAt = calls.findIndex((c) => c.fn === 'drawImage' && c.args[0] === sticker)
    expect(ellipseAt).toBeLessThan(stickerAt)
  })

  it('positions a shape against the full composition width, so it can sit across a panorama seam', () => {
    const layout = getLayout('panorama')
    const panorama = { ...DEFAULT_SETTINGS, layout: 'panorama' as const, positionId: 'lean' }
    const { ctx, calls } = recorder()
    renderScene(
      ctx,
      TILE.w,
      TILE.h,
      { ...screen(), elements: [shapeEl({ x: 0.75, width: 0.2 })] },
      panorama,
      {},
    )
    const [call] = calls.filter((c) => c.fn === 'ellipse')
    const W = TILE.w * layout.span
    expect(call.args[0]).toBeCloseTo(0.75 * W, 5)
  })
})

describe('applyShadow', () => {
  it('sets no shadow for "none"', () => {
    const { ctx, props } = recorder()
    applyShadow(ctx, 'none', 100, '#111114')
    expect(props.shadowColor).toBeUndefined()
    expect(props.shadowBlur).toBeUndefined()
  })

  it('matches the original hard-coded device shadow for "soft"', () => {
    const { ctx, props } = recorder()
    applyShadow(ctx, 'soft', 200, '#111114')
    expect(ctx.shadowColor).toBe('rgba(15, 23, 42, 0.30)')
    expect(ctx.shadowBlur).toBeCloseTo(200 * 0.09, 5)
    expect(ctx.shadowOffsetY).toBeCloseTo(200 * 0.035, 5)
    expect(props.shadowOffsetX).toBeUndefined()
  })

  it('draws a flat, unblurred shadow in the given colour for "hard"', () => {
    const { ctx } = recorder()
    applyShadow(ctx, 'hard', 200, '#ff00aa')
    expect(ctx.shadowColor).toBe('#ff00aa')
    expect(ctx.shadowBlur).toBe(0)
    expect(ctx.shadowOffsetX).toBeCloseTo(200 * 0.03, 5)
    expect(ctx.shadowOffsetY).toBeCloseTo(200 * 0.03, 5)
  })
})

describe('renderScene device shadow', () => {
  const withDevice = { self: fakeImage(400, 800) }

  it('defaults to the soft shadow — same constants as the look before deviceShadow existed', () => {
    const { ctx } = recorder()
    renderScene(ctx, TILE.w, TILE.h, screen(), DEFAULT_SETTINGS, withDevice)
    expect(ctx.shadowColor).toBe('rgba(15, 23, 42, 0.30)')
    expect(ctx.shadowBlur).toBeGreaterThan(0)
    // The blur-to-offset ratio is independent of the device's own box width, so this proves the
    // 'soft' constants without duplicating the device-fitting geometry here.
    expect(ctx.shadowBlur / ctx.shadowOffsetY).toBeCloseTo(0.09 / 0.035, 5)
  })

  it('draws the hard shadow in the effective text colour', () => {
    const { ctx } = recorder()
    const settings = { ...DEFAULT_SETTINGS, deviceShadow: 'hard' as const, textColor: '#ff00aa' }
    renderScene(ctx, TILE.w, TILE.h, screen(), settings, withDevice)
    expect(ctx.shadowColor).toBe('#ff00aa')
    expect(ctx.shadowBlur).toBe(0)
  })

  it('sets no shadow at all for "none"', () => {
    const { ctx, props } = recorder()
    const settings = { ...DEFAULT_SETTINGS, deviceShadow: 'none' as const }
    renderScene(ctx, TILE.w, TILE.h, screen(), settings, withDevice)
    expect(props.shadowBlur).toBeUndefined()
    expect(props.shadowColor).toBeUndefined()
  })

  it('honours a per-screen deviceShadow override', () => {
    const { ctx } = recorder()
    const overridden = screen({ deviceShadow: 'hard', textColor: '#00ff00' })
    renderScene(ctx, TILE.w, TILE.h, overridden, DEFAULT_SETTINGS, withDevice)
    expect(ctx.shadowColor).toBe('#00ff00')
  })
})

describe('drawShape ring', () => {
  const box = { x: 0, y: 0, w: 200, h: 200 }

  it('strokes a circle inset by half the stroke width, so the outer edge lands exactly on the box', () => {
    const { ctx, calls } = recorder()
    drawShape(ctx, box, 'ring', '#ff00aa', 0.2)
    const strokeW = 0.2 * 200
    const r = 100 - strokeW / 2
    const [call] = calls.filter((c) => c.fn === 'ellipse')
    expect(call.args).toEqual([100, 100, r, r, 0, 0, Math.PI * 2])
    expect(ctx.lineWidth).toBeCloseTo(strokeW, 5)
    expect(ctx.strokeStyle).toBe('#ff00aa')
    expect(calls.some((c) => c.fn === 'stroke')).toBe(true)
    expect(calls.some((c) => c.fn === 'fill')).toBe(false)
  })

  it('defaults stroke to 0.12 of the diameter when omitted', () => {
    const { ctx } = recorder()
    drawShape(ctx, box, 'ring', '#000', undefined)
    expect(ctx.lineWidth).toBeCloseTo(0.12 * 200, 5)
  })
})

describe('drawShape blob', () => {
  const box = { x: 0, y: 0, w: 200, h: 200 }

  it('fills a closed bezier path built from the seeded points', () => {
    const { ctx, calls } = recorder()
    drawShape(ctx, box, 'blob', '#eaf2ff', undefined, 7)
    expect(ctx.fillStyle).toBe('#eaf2ff')
    expect(calls.some((c) => c.fn === 'moveTo')).toBe(true)
    expect(calls.filter((c) => c.fn === 'bezierCurveTo')).toHaveLength(7)
    expect(calls.some((c) => c.fn === 'closePath')).toBe(true)
    expect(calls.some((c) => c.fn === 'fill')).toBe(true)
    expect(calls.some((c) => c.fn === 'stroke')).toBe(false)
  })

  it('defaults seed to 1 when omitted', () => {
    const { ctx: a, calls: callsA } = recorder()
    drawShape(a, box, 'blob', '#000')
    const { ctx: b, calls: callsB } = recorder()
    drawShape(b, box, 'blob', '#000', undefined, 1)
    expect(callsA.filter((c) => c.fn === 'bezierCurveTo')).toEqual(
      callsB.filter((c) => c.fn === 'bezierCurveTo'),
    )
  })
})

describe('blobPoints', () => {
  it('has seven points', () => {
    expect(blobPoints(1)).toHaveLength(7)
  })

  it('is deterministic for the same seed', () => {
    expect(blobPoints(3)).toEqual(blobPoints(3))
  })

  it('differs for a different seed', () => {
    expect(blobPoints(3)).not.toEqual(blobPoints(4))
  })

  it('keeps every point within the unit circle the box inscribes', () => {
    for (const seed of [1, 2, 3, 42]) {
      for (const p of blobPoints(seed)) {
        expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('mosaicCells', () => {
  const mosaic = getLayout('mosaic')
  const PLAY_TILE = { w: 1080, h: 2400 }
  const byX = (boxes: Box[]) => {
    const xs = [...new Set(boxes.map((b) => Math.round(b.x * 1000) / 1000))].sort((a, b) => a - b)
    return xs.map((x) => boxes.filter((b) => Math.abs(b.x - x) < 0.001))
  }

  it('is empty for a count of zero', () => {
    expect(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 0)).toEqual([])
  })

  it('emits one box per cell', () => {
    for (const count of [4, 5, 6])
      expect(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, count)).toHaveLength(count)
  })

  it('4 cells: two columns of two', () => {
    const cols = byX(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 4))
    expect(cols.map((c) => c.length)).toEqual([2, 2])
  })

  it('6 cells: three columns, 2/2/2', () => {
    const cols = byX(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 6))
    expect(cols.map((c) => c.length)).toEqual([2, 2, 2])
  })

  it('5 cells: three columns, 2/1/2 — the outer columns keep two rows, the middle drops to one', () => {
    const cols = byX(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 5))
    expect(cols.map((c) => c.length)).toEqual([2, 1, 2])
  })

  it('gives every cell the target device screen aspect, not a fixed shape', () => {
    for (const box of mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 5))
      expect(box.w / box.h).toBeCloseTo(ASPECT, 5)
    const wide = mosaicCells(mosaic, TILE.w, TILE.h, 0.7, 5)
    expect(wide[0].w / wide[0].h).toBeCloseTo(0.7, 5)
  })

  it('4 cells: staggers the right column down by 0.35 of a cell height', () => {
    const cols = byX(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 4))
    const [left, right] = cols
    expect(right[0].y).toBeCloseTo(left[0].y + 0.35 * left[0].h, 5)
  })

  it('5–6 cells: staggers the middle column down by half a cell height', () => {
    for (const count of [5, 6]) {
      const cols = byX(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, count))
      const [outerLeft, middle] = cols
      expect(middle[0].y).toBeCloseTo(outerLeft[0].y + 0.5 * outerLeft[0].h, 5)
    }
  })

  it('5 cells: the lone middle cell sits between the two outer rows, not pinned to the first', () => {
    const cols = byX(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 5))
    const [outerLeft, middle] = cols
    const outerRow0Center = outerLeft[0].y + outerLeft[0].h / 2
    const outerRow1Center = outerLeft[1].y + outerLeft[1].h / 2
    const middleCenter = middle[0].y + middle[0].h / 2
    expect(middleCenter).toBeGreaterThan(outerRow0Center)
    expect(middleCenter).toBeLessThan(outerRow1Center)
  })

  it('starts the grid right under the text band, not vertically centred', () => {
    const boxes = mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 6)
    expect(Math.min(...boxes.map((b) => b.y))).toBeCloseTo(TILE.h * mosaic.device.top, 5)
  })

  it('centres the grid horizontally within the tile, at full size and when shrunk', () => {
    for (const count of [4, 5, 6]) {
      const boxes = mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, count)
      const left = Math.min(...boxes.map((b) => b.x))
      const right = TILE.w - Math.max(...boxes.map((b) => b.x + b.w))
      expect(left).toBeCloseTo(right, 5)
    }
  })

  it('keeps every cell at least half visible on-canvas, at both target sizes, for 4/5/6 cells', () => {
    for (const [w, h] of [
      [TILE.w, TILE.h],
      [PLAY_TILE.w, PLAY_TILE.h],
    ] as const) {
      for (const count of [4, 5, 6]) {
        for (const box of mosaicCells(mosaic, w, h, ASPECT, count)) {
          const visible = Math.min(h, box.y + box.h) - Math.max(0, box.y)
          expect(visible / box.h).toBeGreaterThanOrEqual(0.5 - 1e-9)
        }
      }
    }
  })

  it('shrinks the cell for 4 cells (the offset column would otherwise crop past half) but not for 6', () => {
    const rawCellW4 = (TILE.w * (1 - 2 * 0.06 - 0.04)) / 2
    const rawCellW6 = (TILE.w * (1 - 2 * 0.06 - 2 * 0.04)) / 3
    const [cell4] = mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 4)
    const [cell6] = mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 6)
    expect(cell4.w).toBeLessThan(rawCellW4 - 1)
    expect(cell6.w).toBeCloseTo(rawCellW6, 5)
  })

  it('stacks a column top to bottom with a gap between cells, no overlap', () => {
    const cols = byX(mosaicCells(mosaic, TILE.w, TILE.h, ASPECT, 6))
    for (const col of cols) {
      const sorted = [...col].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i].y).toBeGreaterThan(sorted[i - 1].y + sorted[i - 1].h)
    }
  })
})

describe('renderScene with chips', () => {
  const settings = { ...DEFAULT_SETTINGS, layout: 'text-top' as const, positionId: 'center' }
  const chipEl = (patch: Partial<ChipElement> = {}): ChipElement => ({
    id: 'pill',
    text: 'Hi',
    x: 0.5,
    y: 0.2,
    width: 1,
    size: 0.05,
    rotate: 0,
    layer: 'front',
    shadow: false,
    ...patch,
  })
  // An artwork-kind screen with no headline draws nothing but the background and the chip
  // itself — no device, no text block — so the pill's own calls are never mixed in with theirs.
  const artworkScreen = (elements: ChipElement[]): Screen => ({
    ...screen(),
    headline: '',
    subhead: '',
    kind: 'artwork',
    elements,
  })

  it('draws the pill and the text, with no image at all', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, artworkScreen([chipEl()]), settings, {})
    expect(calls.some((c) => c.fn === 'roundRect')).toBe(true)
    expect(calls.some((c) => c.fn === 'fillText' && c.args[0] === 'Hi')).toBe(true)
    expect(calls.some((c) => c.fn === 'drawImage')).toBe(false)
  })

  it('draws nothing for a chip with no text for this locale', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, artworkScreen([chipEl({ text: '' })]), settings, {})
    expect(calls.some((c) => c.fn === 'roundRect')).toBe(false)
    expect(calls.some((c) => c.fn === 'fillText')).toBe(false)
  })

  it('sizes and centres the pill from the (unshrunk) text plus its own padding', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, artworkScreen([chipEl({ width: 1 })]), settings, {})
    const [call] = calls.filter((c) => c.fn === 'roundRect')
    const size = 0.05 * TILE.h
    const padX = size * CHIP_PAD_X
    const textWidth = 20 // the recorder's measureText stub: 'Hi'.length * 10
    const pillW = textWidth + padX * 2
    const pillH = size * CHIP_HEIGHT
    const cx = 0.5 * TILE.w
    const cy = 0.2 * TILE.h
    expect(call.args).toEqual([cx - pillW / 2, cy - pillH / 2, pillW, pillH, pillH / 2])
  })

  it('fills the pill in the first highlight colour and the text in textColor, absent an override', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, artworkScreen([chipEl()]), settings, {})
    expect(calls.find((c) => c.fn === 'roundRect')!.fillStyle).toBe(settings.highlights[0])
    expect(calls.find((c) => c.fn === 'fillText')!.fillStyle).toBe(settings.textColor)
  })

  it('falls back to white when there are no highlights to draw the pill in', () => {
    const { ctx, calls } = recorder()
    const noHighlights = { ...settings, highlights: [] }
    renderScene(ctx, TILE.w, TILE.h, artworkScreen([chipEl()]), noHighlights, {})
    expect(calls.find((c) => c.fn === 'roundRect')!.fillStyle).toBe('#ffffff')
  })

  it('uses an explicit color and textColor over the defaults', () => {
    const { ctx, calls } = recorder()
    renderScene(
      ctx,
      TILE.w,
      TILE.h,
      artworkScreen([chipEl({ color: '#123456', textColor: '#abcdef' })]),
      settings,
      {},
    )
    expect(calls.find((c) => c.fn === 'roundRect')!.fillStyle).toBe('#123456')
    expect(calls.find((c) => c.fn === 'fillText')!.fillStyle).toBe('#abcdef')
  })

  it('shrinks the font — and with it the pill — until the text fits the max width', () => {
    const { ctx, calls } = recorder()
    // 0.05 of the tile (66px) cannot hold 'Hi' at the requested size (0.05 × 2868 ≈ 143px).
    renderScene(ctx, TILE.w, TILE.h, artworkScreen([chipEl({ width: 0.05 })]), settings, {})
    const [call] = calls.filter((c) => c.fn === 'roundRect')
    expect(call.args[3]).toBeLessThan(0.05 * TILE.h * CHIP_HEIGHT)
  })

  it('rotates the pill and the text together, around the pill centre', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, artworkScreen([chipEl({ rotate: 20 })]), settings, {})
    const rotateCalls = calls.filter((c) => c.fn === 'rotate')
    const translateCalls = calls.filter((c) => c.fn === 'translate')
    expect(rotateCalls).toHaveLength(1)
    expect(rotateCalls[0].args[0]).toBeCloseTo((20 * Math.PI) / 180, 10)
    expect(translateCalls[0].args).toEqual([0.5 * TILE.w, 0.2 * TILE.h])
    expect(translateCalls[1].args).toEqual([-(0.5 * TILE.w), -(0.2 * TILE.h)])
  })

  it('draws a behind chip before the device and a front chip after it', () => {
    const device = fakeImage(400, 800)

    const behind = recorder()
    renderScene(
      behind.ctx,
      TILE.w,
      TILE.h,
      { ...screen(), headline: '', elements: [chipEl({ layer: 'behind' })] },
      settings,
      { self: device },
    )
    const behindTextAt = behind.calls.findIndex((c) => c.fn === 'fillText')
    const behindDeviceAt = behind.calls.findIndex((c) => c.fn === 'drawImage')
    expect(behindTextAt).toBeGreaterThanOrEqual(0)
    expect(behindTextAt).toBeLessThan(behindDeviceAt)

    const front = recorder()
    renderScene(
      front.ctx,
      TILE.w,
      TILE.h,
      { ...screen(), headline: '', elements: [chipEl({ layer: 'front' })] },
      settings,
      { self: device },
    )
    const frontTextAt = front.calls.findIndex((c) => c.fn === 'fillText')
    const frontDeviceAt = front.calls.findIndex((c) => c.fn === 'drawImage')
    expect(frontTextAt).toBeGreaterThan(frontDeviceAt)
  })
})

describe('renderScene with a mosaic layout', () => {
  const settings = { ...DEFAULT_SETTINGS, layout: 'mosaic' as const }
  const withExtra = (n: number): Screen => ({
    ...screen(),
    extraIds: Array.from({ length: n }, (_, i) => `e${i}`),
  })

  it('draws one cell per source: self plus every extra', () => {
    const { ctx, calls } = recorder()
    const img = fakeImage(400, 800)
    renderScene(ctx, TILE.w, TILE.h, withExtra(4), settings, {
      self: img,
      extra: [img, img, null, img],
    })
    // 4 named extras + self = 5 cells; one of the extras has no image, so only 4 draw an image.
    expect(drawn(calls)).toHaveLength(4)
  })

  it('still draws a white card for a cell whose image never loaded', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, withExtra(3), settings, { self: null, extra: [null, null, null] })
    expect(drawn(calls)).toHaveLength(0)
    // roundRect is called twice per cell (the shadowed card, then the clip) in drawMosaicCell.
    expect(calls.filter((c) => c.fn === 'roundRect')).toHaveLength(4 * 2)
  })

  it('draws no devices at all for the mosaic layout', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, withExtra(3), settings, {
      self: fakeImage(400, 800),
      extra: [fakeImage(400, 800), null, fakeImage(400, 800)],
    })
    // A device frame calls roundRect 3 times (body, edge stroke, screen clip) per box; a mosaic
    // cell only 2 (card, clip) — this count is only consistent with the mosaic path having run.
    expect(calls.filter((c) => c.fn === 'roundRect')).toHaveLength(4 * 2)
  })

  it('renders a single self-only cell when the slot names no extra at all', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, screen(), settings, { self: fakeImage(400, 800) })
    expect(drawn(calls)).toHaveLength(1)
  })

  it('tilts the whole grid as one unit instead of leaving every cell axis-aligned', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, withExtra(3), { ...settings, tilt: 5 }, { self: fakeImage(400, 800) })
    expect(calls.some((c) => c.fn === 'rotate')).toBe(true)
  })

  it('applies no rotation at all when tilt is zero', () => {
    const { ctx, calls } = recorder()
    renderScene(ctx, TILE.w, TILE.h, withExtra(3), settings, { self: fakeImage(400, 800) })
    expect(calls.some((c) => c.fn === 'rotate')).toBe(false)
  })

  // A mosaic cell is a frameless device in every way that matters to its shadow — it goes
  // through the same `applyShadow` a device frame does (`drawMosaicCell`), driven by the tile's
  // own `deviceShadow` setting exactly like `drawDevice`.
  it('deviceShadow "none" draws no shadow on a mosaic cell', () => {
    const { ctx, props } = recorder()
    renderScene(
      ctx,
      TILE.w,
      TILE.h,
      withExtra(3),
      { ...settings, deviceShadow: 'none' },
      {
        self: fakeImage(400, 800),
      },
    )
    expect(props.shadowColor).toBeUndefined()
    expect(props.shadowBlur).toBeUndefined()
  })

  it('deviceShadow "hard" draws a flat shadow, offset diagonally, in the effective text colour', () => {
    const { ctx } = recorder()
    const hard = { ...settings, deviceShadow: 'hard' as const, textColor: '#ff00aa' }
    renderScene(ctx, TILE.w, TILE.h, withExtra(3), hard, { self: fakeImage(400, 800) })
    expect(ctx.shadowColor).toBe('#ff00aa')
    expect(ctx.shadowBlur).toBe(0)
    expect(ctx.shadowOffsetX).toBeGreaterThan(0)
    expect(ctx.shadowOffsetX).toBeCloseTo(ctx.shadowOffsetY as number, 5)
  })
})
