import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { OutboxProvider } from './OutboxProvider'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <OutboxProvider>
      <App />
    </OutboxProvider>
  </StrictMode>,
)
