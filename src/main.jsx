import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APIProvider } from '@vis.gl/react-google-maps';
import './index.css'
import App from './App.jsx'
import { reportMapsError } from './lib/toast'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

// Google invoca este callback global cuando falla la autenticación del SDK de
// Maps (clave inválida, billing deshabilitado, restricciones). Mostramos banner.
window.gm_authFailure = () => reportMapsError();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <APIProvider apiKey={MAPS_KEY} libraries={['places', 'geometry', 'routes']}>
      <App />
    </APIProvider>
  </StrictMode>,
)
