import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  // Consumers may serve the bundle from a sub-path, so assets stay relative.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  // Only pure logic is unit-tested — anything touching a real canvas is verified visually
  // instead. See _context/workflows.md.
  test: { include: ['src/**/*.test.ts', 'cli/**/*.test.ts'], environment: 'node' },
})
