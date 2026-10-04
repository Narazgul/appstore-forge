import { describe, expect, it } from 'vitest'
import { meanHex } from './averageColor'

describe('meanHex', () => {
  it('averages every channel and ignores alpha', () => {
    expect(meanHex(new Uint8ClampedArray([0, 0, 0, 255, 255, 101, 20, 0]))).toBe('#80330a')
  })
  it('is black for no pixels at all', () => {
    expect(meanHex(new Uint8ClampedArray())).toBe('#000000')
  })
})
