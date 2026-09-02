import '@fontsource-variable/inter'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/playfair-display'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/700.css'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { fileProjectStore } from './adapters/fileClient'
import { App } from './App'
import { preloadFonts } from './presets/fonts'
import { useStore } from './store'

// Canvas measures text against whatever is actually loaded, and the preview must match the
// export exactly — so every family is fetched before the first paint.
preloadFonts().then(async () => {
  if (__FORGE_PROJECT__) await useStore.getState().openProject(fileProjectStore())
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
