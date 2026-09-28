import { GlobalFonts } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONTS } from '../src/presets/fonts'
import { SCRIPT_FONTS } from '../src/presets/scripts'

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts')
let registered = false

/** Inter and the script fonts are variable masters; the renderer picks their weight via the `wght` axis. */
const FONT_FILES: Record<string, string[]> = {
  inter: ['Inter.ttf'],
  'dm-sans': ['DMSans-Regular.ttf', 'DMSans-Bold.ttf'],
  poppins: ['Poppins-Regular.ttf', 'Poppins-Bold.ttf'],
  'space-grotesk': ['SpaceGrotesk-Regular.ttf', 'SpaceGrotesk-Bold.ttf'],
  playfair: ['PlayfairDisplay-Regular.ttf', 'PlayfairDisplay-Bold.ttf'],
  'baloo-2': ['Baloo2-Regular.ttf', 'Baloo2-Bold.ttf'],
  nunito: ['Nunito-Regular.ttf', 'Nunito-Bold.ttf'],
}

/** Skia knows no system fallback we control, so every family the renderer may ask for is registered up front. */
export function registerFonts(): void {
  if (registered) return
  const files: [string, string][] = [
    ...FONTS.filter((f) => f.family).flatMap((f): [string, string][] => {
      const names = FONT_FILES[f.id]
      if (!names) throw new Error(`No font files registered for "${f.id}"`)
      return names.map((file) => [file, f.family])
    }),
    ...SCRIPT_FONTS.map((f): [string, string] => [f.file, f.family]),
  ]
  for (const [file, family] of files) {
    const path = join(FONT_DIR, file)
    if (!existsSync(path)) throw new Error(`Font file missing: ${path}`)
    GlobalFonts.registerFromPath(path, family)
  }
  registered = true
}
