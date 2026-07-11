import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@amiclaw/ui/styles/tokens.css'
import '@amiclaw/ui/styles/animations.css'
import './styles/tokens.css'
import './app.css'

// The playable's levels (game-type + engine Levels + concrete content) are
// assembled in content/levels.ts, the structural SSOT: the engine drives state
// + win from each Level, and the codebook derives the decoder view from it. App
// resolves the active level from the URL hash. Shared @amiclaw/ui tokens +
// animations load first, then the radio-cipher --rc-* identity layer, then the
// component stylesheet — so app.css can reference both shared and local tokens.
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
