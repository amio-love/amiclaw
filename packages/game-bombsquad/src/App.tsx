import { Routes, Route } from 'react-router-dom'
import { GameProvider } from './store/game-context'
import BombSquadLandingPage from './pages/BombSquadLandingPage'
import ConnectPage from './pages/ConnectPage'
import GamePage from './pages/GamePage'
import ResultPage from './pages/ResultPage'
import CompatibilityPage from './pages/CompatibilityPage'

export default function App() {
  return (
    <GameProvider>
      <Routes>
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
        {/* Legacy pre-split paths (/game, /result, /compatibility, …) are now
            served by the platform deploy root via Cloudflare static 301
            redirects in packages/platform/public/_redirects — they no longer
            reach this SPA, so no in-app Navigate routes are needed. */}
      </Routes>
    </GameProvider>
  )
}
