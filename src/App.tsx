import { Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './components/AppLayout'
import DashboardPage from './pages/DashboardPage'
import DiscoverPage from './pages/DiscoverPage'
import DevicesPage from './pages/DevicesPage'
import DeviceConnectPage from './pages/DeviceConnectPage'
import HomePage from './pages/HomePage'
import QuestAttemptPage from './pages/QuestAttemptPage'
import SideQuestPage from './pages/SideQuestPage'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="quests" element={<SideQuestPage />} />
        <Route path="quests/:code" element={<QuestAttemptPage />} />
        <Route path="quest-attempts/:attemptId" element={<QuestAttemptPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="discover" element={<DiscoverPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="devices/connect/:requestId" element={<DeviceConnectPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
