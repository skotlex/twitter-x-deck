import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 를 찾지 못했다. deck.html 이 손상됐다.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
