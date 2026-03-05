import { ArrowLeft, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PageHeader({ title, subtitle, onBack, onClose, rightAction }) {
    const navigate = useNavigate();

    return (
        <header className="page-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {onBack && (
                    <button
                        onClick={onBack || (() => navigate(-1))}
                        style={{ display: 'flex', padding: '8px', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                        aria-label="Volver"
                    >
                        <ArrowLeft size={22} />
                    </button>
                )}
                {onClose && (
                    <button
                        onClick={onClose}
                        style={{ display: 'flex', padding: '8px', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
                        aria-label="Cerrar"
                    >
                        <X size={22} />
                    </button>
                )}
                <div>
                    <h1 style={{ fontSize: '18px', fontWeight: 700 }}>{title}</h1>
                    {subtitle && <p className="text-caption text-secondary">{subtitle}</p>}
                </div>
            </div>
            {rightAction && <div>{rightAction}</div>}
        </header>
    );
}
