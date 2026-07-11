import { createRoot } from 'react-dom/client'
import { App } from './App'
// Atlas platform shell (cosmic bg + text/border/semantic tokens) FIRST, then the
// game's registered accent layer, then the game styles that consume both.
import '@amiclaw/ui/styles/tokens.css'
import '@amiclaw/ui/styles/animations.css'
import './styles/tokens.css'
import './styles/sound-garden.css'

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
