import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthRoot } from './Auth'
import './styles.css'
import './enhancements.css'
import './auth.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><AuthRoot /></StrictMode>,
)
