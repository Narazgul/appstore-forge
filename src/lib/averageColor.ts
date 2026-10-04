/** The mean colour of RGBA pixels as #rrggbb, alpha ignored. */
export function meanHex(data: Uint8ClampedArray): string {
  const sum = [0, 0, 0]
  const count = data.length / 4
  if (!count) return '#000000'
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c]
  return `#${sum
    .map((v) =>
      Math.round(v / count)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** An image's mean colour, sampled on 16 × 16 like `forge bg fetch` does for the credits. */
export function imageAverageColor(img: CanvasImageSource): string {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return '#000000'
  ctx.drawImage(img, 0, 0, 16, 16)
  return meanHex(ctx.getImageData(0, 0, 16, 16).data)
}
