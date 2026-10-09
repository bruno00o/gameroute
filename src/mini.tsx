import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import { MiniApp } from '@/components/mini/mini-app'
import { ThemeProvider } from '@/components/theme-provider'

const RELOAD_ON = new Set(['vite-ui-theme', 'PARAGLIDE_LOCALE'])

window.addEventListener('storage', event => {
  if (event.key && RELOAD_ON.has(event.key)) window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <MiniApp />
    </ThemeProvider>
  </StrictMode>
)
