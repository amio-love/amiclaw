import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SessionProvider } from './session'
import { PageHome } from './pages/PageHome'
import { PageProjection } from './pages/PageProjection'
import { PageCasting } from './pages/PageCasting'
import { PageReading } from './pages/PageReading'
import { PageSign } from './pages/PageSign'

/* Hash-routed 5-screen scaffold (sibling 1 Round 4). Sibling 2 replaces every
   placeholder page with the hi-fi implementation per handoff §6 and wires
   real interactions into the SessionProvider actions. */
export default function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<PageHome />} />
          <Route path="/projection" element={<PageProjection />} />
          <Route path="/casting" element={<PageCasting />} />
          <Route path="/reading" element={<PageReading />} />
          <Route path="/sign" element={<PageSign />} />
        </Routes>
      </HashRouter>
    </SessionProvider>
  )
}
