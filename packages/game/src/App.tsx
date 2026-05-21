import { Routes, Route } from 'react-router-dom'
import { GameProvider } from './store/game-context'
import PlatformLayout from './components/platform/PlatformLayout'
import GamesPage from './pages/GamesPage'
import GamePage from './pages/GamePage'
import ResultPage from './pages/ResultPage'
import LeaderboardPage from './pages/LeaderboardPage'
import CommunityPage from './pages/CommunityPage'
import AccountPage from './pages/AccountPage'
import CompatibilityPage from './pages/CompatibilityPage'

export default function App() {
  return (
    <GameProvider>
      <Routes>
        {/* Platform routes — render inside the platform shell (TopNav / Scenery / footer). */}
        <Route element={<PlatformLayout />}>
          <Route path="/" element={<GamesPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/me" element={<AccountPage />} />
        </Route>
        {/* Immersive BombSquad game flow — no platform shell. */}
        <Route path="/game" element={<GamePage />} />
        <Route path="/result" element={<ResultPage />} />
        <Route path="/compatibility" element={<CompatibilityPage />} />
      </Routes>
    </GameProvider>
  )
}
