import { CheckCircle2, AlertCircle, Info, X, MapPinOff } from 'lucide-react';
import { useToastStore } from '../lib/toast';

const ICONS = {
  success: <CheckCircle2 size={18} />,
  error: <AlertCircle size={18} />,
  info: <Info size={18} />,
};

const COLORS = {
  success: '#10b981',
  error: '#ef4444',
  info: 'var(--color-primary)',
};

// Renderiza los toasts y el banner global de error de Mapas.
// Se monta una sola vez (en App).
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const mapsError = useToastStore((s) => s.mapsError);

  return (
    <>
      {mapsError && (
        <div
          role="alert"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: '#7f1d1d', color: '#fff', padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: '10px',
            fontSize: '13px', fontWeight: 600, lineHeight: 1.3,
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          }}
        >
          <MapPinOff size={18} style={{ flexShrink: 0 }} />
          <span>
            Google Maps no disponible. Revisa que la facturación y la clave de API
            estén activas en Google Cloud.
          </span>
        </div>
      )}

      <div
        style={{
          position: 'fixed', bottom: 'calc(var(--nav-height) + 16px)', left: '50%',
          transform: 'translateX(-50%)', zIndex: 9998,
          display: 'flex', flexDirection: 'column', gap: '8px',
          width: 'calc(100% - 32px)', maxWidth: '420px', pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-fade-in-up"
            style={{
              pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '10px',
              background: 'var(--bg-card)', color: 'var(--text-primary)',
              borderLeft: `4px solid ${COLORS[t.type] || COLORS.info}`,
              borderRadius: 'var(--radius-md)', padding: '12px 14px',
              boxShadow: 'var(--shadow-xl)', fontSize: '14px', fontWeight: 600,
            }}
          >
            <span style={{ color: COLORS[t.type] || COLORS.info, flexShrink: 0, display: 'flex' }}>
              {ICONS[t.type] || ICONS.info}
            </span>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex' }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
