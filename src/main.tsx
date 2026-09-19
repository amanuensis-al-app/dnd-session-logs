import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Gilded-tome theme fonts, bundled (not Google Fonts) so the offline standalone
// build still has them. Latin subset only.
import '@fontsource/cinzel/latin-500.css'
import '@fontsource/cinzel/latin-700.css'
import '@fontsource/eb-garamond/latin-400.css'
import '@fontsource/eb-garamond/latin-400-italic.css'
import '@fontsource/eb-garamond/latin-600.css'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './registerServiceWorker.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
