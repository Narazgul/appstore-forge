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
import { firestoreProjectStore, type CompatFirebase } from './adapters/firestoreClient'
import { App } from './App'
import { preloadFonts } from './presets/fonts'
import { useStore } from './store'

// Canvas measures text against whatever is actually loaded, and the preview must match the
// export exactly — so every family is fetched before the first paint.
const root = document.getElementById('root')!
root.style.padding = '24px'
root.style.font = '14px system-ui, sans-serif'
root.style.color = '#666'
root.textContent = 'AppStore Forge lädt Schriften und Quellbilder …'

preloadFonts()
  .then(async () => {
    if (import.meta.env.VITE_FORGE_ADAPTER === 'firestore') {
      const host = (window.parent as unknown as { forgeFirebase?: CompatFirebase }).forgeFirebase
      if (!host) throw new Error('Forge im Backoffice braucht window.parent.forgeFirebase')
      const setId = new URLSearchParams(location.search).get('set') ?? 'default'
      // hostJson: the payload has to be built in the realm the SDK lives in — see firestoreClient.
      const hostJson = (window.parent as unknown as { JSON: JSON }).JSON
      await useStore.getState().openProject(firestoreProjectStore({ setId, firebase: host, hostJson }))
    } else if (__FORGE_PROJECT__) {
      await useStore.getState().openProject(fileProjectStore())
    }
    root.removeAttribute('style')
    root.textContent = ''
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    // Fonts and the project are loaded before the first paint, so a failure here would
    // otherwise leave a white page with nothing to go on.
    root.style.padding = '24px'
    root.textContent = `AppStore Forge could not start: ${error instanceof Error ? error.message : String(error)}`
  })
