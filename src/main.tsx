import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import LegacyDataMigrationGate from './components/LegacyDataMigrationGate'
import { QuestCatalogProvider } from './contexts/QuestCatalogContext'
import { PointProvider } from './contexts/PointContext'
import { SessionProvider } from './contexts/SessionContext'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('애플리케이션을 마운트할 root 요소를 찾을 수 없습니다.')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <LegacyDataMigrationGate>
        <SessionProvider>
          <PointProvider>
            <QuestCatalogProvider>
              <App />
            </QuestCatalogProvider>
          </PointProvider>
        </SessionProvider>
      </LegacyDataMigrationGate>
    </BrowserRouter>
  </StrictMode>,
)
