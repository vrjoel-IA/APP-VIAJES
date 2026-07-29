import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

// Aviso fijo cuando no hay conexión. Uso típico de la app: en la calle, con mala
// cobertura. Deja claro que los datos siguen ahí y qué funciones necesitan red.
export default function OfflineBanner() {
    const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);

    useEffect(() => {
        const goOnline = () => setOffline(false);
        const goOffline = () => setOffline(true);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    if (!offline) return null;

    return (
        <div
            role="status"
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000,
                background: '#0f172a', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '8px 14px', fontSize: 13, fontWeight: 600,
                boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
            }}
        >
            <WifiOff size={15} style={{ flexShrink: 0 }} />
            <span>Sin conexión · tus datos están guardados. La búsqueda y el cálculo de rutas volverán con la red.</span>
        </div>
    );
}
