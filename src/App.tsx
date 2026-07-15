import { Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './components/AppLayout'
import DashboardPage from './pages/DashboardPage'
import HomePage from './pages/HomePage'
import SideQuestPage from './pages/SideQuestPage'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="quests" element={<SideQuestPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
