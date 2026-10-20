import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import './styles/tokens.css'
import './styles/global.css'
import { apiMode } from './api/client'
import { App } from './app/App'

async function bootstrap() {
  if (apiMode === 'mock') {
    const { startMockWorker } = await import('./api/mock')
    await startMockWorker()
  }
  const container = document.getElementById('root')
  if (!container) throw new Error('Root element not found')
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
