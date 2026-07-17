import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import "leaflet/dist/leaflet.css";
// import "leaflet-draw/dist/leaflet.draw.css";
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
