import { useState } from 'react';
import { Lock, KeyRound, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import './Auth.css';

// Pantalla para fijar una nueva contraseña. Se muestra cuando Supabase emite el
// evento PASSWORD_RECOVERY (el usuario llega desde el enlace del correo).
export default function ResetPassword({ onDone }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        if (password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres.');
        if (password !== confirm) return setError('Las contraseñas no coinciden.');

        setLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            toast('Contraseña actualizada. ¡Listo!', 'success');
            onDone?.();
        } catch (err) {
            setError(err.message || 'No se pudo actualizar la contraseña.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-container card animate-fade-in-up">
                <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: 'var(--radius-xl)', marginBottom: '16px' }}>
                        <KeyRound size={28} />
                    </div>
                    <h1 className="text-title">Nueva contraseña</h1>
                    <p className="text-body text-secondary" style={{ marginTop: '8px' }}>
                        Introduce tu nueva contraseña para tu cuenta.
                    </p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {error && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px', background: '#fee2e2', color: 'var(--color-danger)', borderRadius: 'var(--radius-md)', fontSize: '14px' }}>
                            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="input-group">
                        <div className="input-icon"><Lock size={18} /></div>
                        <input
                            type="password"
                            className="input-field"
                            placeholder="Nueva contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                        />
                    </div>

                    <div className="input-group">
                        <div className="input-icon"><Lock size={18} /></div>
                        <input
                            type="password"
                            className="input-field"
                            placeholder="Repite la contraseña"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            required
                            minLength={6}
                        />
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }} disabled={loading}>
                        {loading ? 'Guardando...' : 'Guardar contraseña'}
                    </button>
                </form>
            </div>
        </div>
    );
}
