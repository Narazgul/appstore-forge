import type { DeviceSpec, FrameColor } from '../types'

export type Box = { x: number; y: number; w: number; h: number }

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath()
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.max(0, Math.min(r, b.w / 2, b.h / 2)))
}

/** Cover-fit an image into a box, anchored to the top so the status bar is never cropped. */
function drawCoverTop(ctx: CanvasRenderingContext2D, img: CanvasImageSource, b: Box) {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
  if (!iw || !ih) return
  const scale = Math.max(b.w / iw, b.h / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(img, b.x + (b.w - dw) / 2, b.y, dw, dh)
}

/**
 * An image on its own: contain-fitted and centred in the box, no body, no bezel, no notch.
 * Nothing is filled behind it, so a PNG with an alpha channel keeps the background showing through.
 */
export function drawArtwork(ctx: CanvasRenderingContext2D, box: Box, img: CanvasImageSource) {
  const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
  const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
  if (!iw || !ih) return
  const scale = Math.min(box.w / iw, box.h / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh)
}

function drawNotch(ctx: CanvasRenderingContext2D, screen: Box, device: DeviceSpec, frameW: number) {
  if (device.notch === 'island') {
    const w = frameW * 0.3
    const h = frameW * 0.085
    ctx.fillStyle = '#08080a'
    roundRect(ctx, { x: screen.x + (screen.w - w) / 2, y: screen.y + frameW * 0.028, w, h }, h / 2)
    ctx.fill()
  } else if (device.notch === 'punch') {
    const r = frameW * 0.026
    ctx.fillStyle = '#08080a'
    ctx.beginPath()
    ctx.arc(screen.x + screen.w / 2, screen.y + frameW * 0.055, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * Draw a device frame with the screenshot inside it. `box` is the outer frame bounds;
 * the caller is responsible for having already fitted `box` to the frame's aspect ratio.
 */
export function drawDevice(
  ctx: CanvasRenderingContext2D,
  box: Box,
  device: DeviceSpec,
  color: FrameColor,
  img: CanvasImageSource | null,
) {
  const outerR = device.radius * box.w
  const bezel = device.bezel * box.w
  const screen: Box = {
    x: box.x + bezel,
    y: box.y + bezel,
    w: box.w - bezel * 2,
    h: box.h - bezel * 2,
  }
  const screenR = Math.max(0, outerR - bezel)

  ctx.save()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.30)'
  ctx.shadowBlur = box.w * 0.09
  ctx.shadowOffsetY = box.w * 0.035

  if (bezel > 0) {
    ctx.fillStyle = color.body
    roundRect(ctx, box, outerR)
    ctx.fill()
  } else {
    // Frameless: the shadow has to come from the screenshot's own silhouette.
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, box, outerR)
    ctx.fill()
  }
  ctx.restore()

  if (bezel > 0) {
    ctx.save()
    ctx.strokeStyle = color.edge
    ctx.lineWidth = Math.max(1, box.w * 0.005)
    roundRect(
      ctx,
      {
        x: box.x + ctx.lineWidth / 2,
        y: box.y + ctx.lineWidth / 2,
        w: box.w - ctx.lineWidth,
        h: box.h - ctx.lineWidth,
      },
      outerR,
    )
    ctx.stroke()
    ctx.restore()
  }

  ctx.save()
  roundRect(ctx, screen, screenR)
  ctx.clip()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h)
  if (img) drawCoverTop(ctx, img, screen)
  drawNotch(ctx, screen, device, box.w)
  ctx.restore()
}
