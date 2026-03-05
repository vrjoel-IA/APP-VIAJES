import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Sparkles, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import './Auth.css';

export default function Login() {
    const navigate = useNavigate();
    const { setSession } = useAuthStore();
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleAuth = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (isLogin) {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                setSession(data.session);
                navigate('/');
            } else {
                const { data, error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                if (data.session) {
                    setSession(data.session);
                    navigate('/');
                } else {
                    setError('Revisa tu correo para confirmar tu cuenta.');
                }
            }
        } catch (err) {
            setError(err.message || 'Ha ocurrido un error durante la autenticación.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-container card animate-fade-in-up">
                <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: 'var(--radius-xl)', marginBottom: '16px' }}>
                        <Sparkles size={28} />
                    </div>
                    <h1 className="text-title">{isLogin ? 'Bienvenido de nuevo' : 'Crea tu cuenta'}</h1>
                    <p className="text-body text-secondary" style={{ marginTop: '8px' }}>
                        {isLogin ? 'Inicia sesión para planificar y acceder a tus viajes mágicos.' : 'Regístrate para empezar a organizar tus aventuras.'}
                    </p>
                </div>

                <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {error && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px', background: '#fee2e2', color: 'var(--color-danger)', borderRadius: 'var(--radius-md)', fontSize: '14px' }}>
                            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="input-group">
                        <div className="input-icon"><Mail size={18} /></div>
                        <input
                            type="email"
                            className="input-field"
                            placeholder="Tu correo electrónico"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <div className="input-icon"><Lock size={18} /></div>
                        <input
                            type="password"
                            className="input-field"
                            placeholder="Tu contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                        />
                    </div>

                    <button type="submit" className="btn btn-primary" style={{ marginTop: '8px' }} disabled={loading}>
                        {loading ? 'Cargando...' : (isLogin ? 'Iniciar Sesión' : 'Registrarse')}
                    </button>
                </form>

                <div style={{ textAlign: 'center', marginTop: 'var(--space-xl)' }}>
                    <button
                        className="text-caption"
                        style={{ color: 'var(--color-primary)', fontWeight: 600 }}
                        onClick={() => { setIsLogin(!isLogin); setError(null); }}
                    >
                        {isLogin ? '¿No tienes cuenta? Regístrate gratis' : '¿Ya tienes cuenta? Inicia sesión'}
                    </button>
                </div>
            </div>
        </div>
    );
}
