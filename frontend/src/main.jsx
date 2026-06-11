import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { OutboxProvider } from './OutboxProvider'
import { AuthProvider } from './AuthProvider'
import { ToastProvider } from './ui/ToastProvider'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <OutboxProvider>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </OutboxProvider>
  </StrictMode>,
)
