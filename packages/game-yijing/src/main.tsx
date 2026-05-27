import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@amiclaw/ui/styles/tokens.css'
import '@amiclaw/ui/styles/animations.css'
import './styles/tokens.css'
import './styles/animations.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
