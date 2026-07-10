import { Routes, Route, Navigate } from 'react-router-dom'
import { GamePage } from './pages/GamePage'
import { ManualPage } from './pages/ManualPage'

/* Botanical Garden shell (gardener-view playable probe).
   `/` is the playable tutorial level (bg-demo-001); `/manual` is the
   dev/inspection botanist-manual surface (not linked from the player screen).
   Later rounds add the standard level (R5) and voice/text panels (R6/R7) as
   sibling routes — the router is the seam kept clean for them. */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GamePage />} />
      <Route path="/manual" element={<ManualPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
