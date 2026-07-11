import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import '@amiclaw/ui/styles/tokens.css'
import '@amiclaw/ui/styles/animations.css'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/botanical">
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
