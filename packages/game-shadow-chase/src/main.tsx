import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

import '@amiclaw/ui/styles/tokens.css'
import '@amiclaw/ui/styles/animations.css'
import './styles/tokens.css'
import './styles/global.css'
import { App } from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <App />
  </HashRouter>
)
