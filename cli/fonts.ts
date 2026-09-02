import { GlobalFonts } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCRIPT_FONTS } from '../src/presets/scripts'

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts')
let registered = false

/** Skia knows no system fallback we control, so every family the renderer may ask for is registered up front. */
export function registerFonts(): void {
  if (registered) return
  const files: [string, string][] = [
    ['Inter.ttf', 'Inter Variable'],
    ...SCRIPT_FONTS.map((f): [string, string] => [f.file, f.family]),
  ]
  for (const [file, family] of files) {
    const path = join(FONT_DIR, file)
    if (!existsSync(path)) throw new Error(`Font file missing: ${path}`)
    GlobalFonts.registerFromPath(path, family)
  }
  registered = true
}
