import '@fontsource-variable/inter'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/playfair-display'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/700.css'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { preloadFonts } from './presets/fonts'

// Canvas measures text against whatever is actually loaded, and the preview must match the
// export exactly — so every family is fetched before the first paint.
preloadFonts().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
