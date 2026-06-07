import { Routes, Route } from 'react-router-dom'
import PlatformLayout from './components/platform/PlatformLayout'
import GamesPage from './pages/GamesPage'
import LeaderboardPage from './pages/LeaderboardPage'
import CommunityPage from './pages/CommunityPage'
import AccountPage from './pages/AccountPage'
import PrivacyPage from './pages/PrivacyPage'
import TermsPage from './pages/TermsPage'

export default function App() {
  return (
    <Routes>
      {/* Platform routes — render inside the platform shell (TopNav / Scenery / footer). */}
      <Route element={<PlatformLayout />}>
        <Route path="/" element={<GamesPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/community" element={<CommunityPage />} />
        <Route path="/me" element={<AccountPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Route>
    </Routes>
  )
}
