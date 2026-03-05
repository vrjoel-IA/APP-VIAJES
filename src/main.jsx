import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APIProvider } from '@vis.gl/react-google-maps';
import './index.css'
import App from './App.jsx'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <APIProvider apiKey={MAPS_KEY} libraries={['places', 'geometry', 'routes']}>
      <App />
    </APIProvider>
  </StrictMode>,
)
