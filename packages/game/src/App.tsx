import { Routes, Route, Navigate } from 'react-router-dom'
import { GameProvider } from './store/game-context'
import PlatformLayout from './components/platform/PlatformLayout'
import GamesPage from './pages/GamesPage'
import BombSquadLandingPage from './pages/BombSquadLandingPage'
import ConnectPage from './pages/ConnectPage'
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
        {/* Immersive BombSquad game flow — no platform shell. The flow is
            landing (/bombsquad) → connect (/bombsquad/connect) → run
            (/bombsquad/run) → result (/bombsquad/result). The platform
            homepage's BombSquad CTAs enter at the landing; the run keeps
            the ?mode= / ?url= query params. The route prefix mirrors the
            Yijing Oracle's /oracle/* pattern so every game lives under
            its own sub-path on the claw.amio.fans platform. */}
        <Route path="/bombsquad" element={<BombSquadLandingPage />} />
        <Route path="/bombsquad/connect" element={<ConnectPage />} />
        <Route path="/bombsquad/run" element={<GamePage />} />
        <Route path="/bombsquad/result" element={<ResultPage />} />
        <Route path="/bombsquad/compatibility" element={<CompatibilityPage />} />
        {/* Legacy-path defensive redirects — any in-app Link/navigate target
            that still points at the pre-prefix routes lands on the new
            canonical path instead of 404'ing. External link rewrites for
            bombsquad.amio.fans live in functions/_middleware.ts. */}
        <Route path="/game" element={<Navigate to="/bombsquad" replace />} />
        <Route path="/game/connect" element={<Navigate to="/bombsquad/connect" replace />} />
        <Route path="/game/run" element={<Navigate to="/bombsquad/run" replace />} />
        <Route path="/result" element={<Navigate to="/bombsquad/result" replace />} />
        <Route path="/compatibility" element={<Navigate to="/bombsquad/compatibility" replace />} />
      </Routes>
    </GameProvider>
  )
}
