import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { imageOpaqueBounds, opaqueBounds } from './opaqueBounds'

const rgba = (w: number, h: number, paint: (x: number, y: number) => boolean) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (paint(x, y)) data[(y * w + x) * 4 + 3] = 255
  return data
}

describe('opaqueBounds', () => {
  it('boxes the drawn pixels as fractions of the image', () => {
    const data = rgba(10, 10, (x, y) => x >= 2 && x < 6 && y >= 5 && y < 9)
    expect(opaqueBounds(data, 10, 10)).toEqual({ left: 0.2, right: 0.6, top: 0.5, bottom: 0.9 })
  })

  it('ignores a nearly transparent haze and reports nothing for an empty image', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 3; i < data.length; i += 4) data[i] = 4
    expect(opaqueBounds(data, 4, 4)).toBeNull()
  })
})

describe('imageOpaqueBounds', () => {
  it('samples a large picture down and still finds the drawn part', () => {
    const src = createCanvas(1000, 500)
    const c = src.getContext('2d')
    c.fillStyle = '#f00'
    c.fillRect(500, 0, 500, 500)
    const bounds = imageOpaqueBounds(
      src as unknown as CanvasImageSource & { width: number; height: number },
      (w, h) => createCanvas(w, h).getContext('2d') as unknown as CanvasRenderingContext2D,
    )
    expect(bounds!.left).toBeCloseTo(0.5, 2)
    expect(bounds!.right).toBe(1)
    expect(bounds!.top).toBe(0)
    expect(bounds!.bottom).toBe(1)
  })
})
