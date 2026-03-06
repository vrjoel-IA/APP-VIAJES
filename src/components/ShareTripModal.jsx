import { useState } from 'react';
import { X, UserPlus, Trash2, Mail } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

export default function ShareTripModal({ trip, store, onClose }) {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const { user } = useAuthStore();

    // Determine the owner email. If trip.userId matches user.id, it's the current user. 
    // Otherwise we only have their ID right now, so we just say "Creador Original".
    const isOwner = Boolean(trip?.userId && user?.id && trip.userId === user.id);

    const handleShare = (e) => {
        e.preventDefault();
        setError('');

        const emailTrimmed = email.trim().toLowerCase();
        if (!emailTrimmed) return;
        if (!emailTrimmed.includes('@')) {
            setError('Por favor, introduce un email válido.');
            return;
        }

        if ((trip.sharedWith || []).includes(emailTrimmed)) {
            setError('Este usuario ya está invitado al viaje.');
            return;
        }

        store.shareTrip(trip.id, emailTrimmed);
        setEmail('');
    };

    return (
        <div className="modal-overlay animate-fade-in" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="text-subtitle" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <UserPlus size={24} color="var(--color-primary)" />
                        Compartir Viaje
                    </h2>
                    <button onClick={onClose} className="modal-close"><X size={22} /></button>
                </div>

                <p className="text-caption text-secondary" style={{ marginBottom: 'var(--space-lg)' }}>
                    Añade el correo electrónico de tus amigos o familiares para que también puedan ver y editar <strong>{trip.name}</strong> desde sus cuentas.
                </p>

                <form onSubmit={handleShare} style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-xl)' }}>
                    <div className="input-group" style={{ flex: 1 }}>
                        <div className="input-icon"><Mail size={18} /></div>
                        <input
                            type="email"
                            className="input-field"
                            value={email}
                            onChange={e => { setEmail(e.target.value); setError(''); }}
                            placeholder="amigo@correo.com"
                            autoFocus
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ padding: '12px 16px' }}>
                        Invitar
                    </button>
                </form>

                {error && <p className="text-caption" style={{ color: 'var(--color-danger)', marginTop: '-12px', marginBottom: 'var(--space-md)' }}>{error}</p>}

                <div>
                    <h3 className="text-body" style={{ fontWeight: 700, marginBottom: 'var(--space-md)' }}>Viajeros en este viaje:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                        {/* Creador Item */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                    C
                                </div>
                                <div>
                                    <p className="text-body" style={{ fontWeight: 600 }}>{isOwner ? 'Tú (Creador)' : 'Creador Original'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Invitados (Shared With) */}
                        {(trip.sharedWith || []).map(collaboratorEmail => {
                            const isMe = Boolean(collaboratorEmail && user?.email && collaboratorEmail.toLowerCase() === user.email.toLowerCase());
                            return (
                                <div key={collaboratorEmail} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--text-tertiary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                                            {collaboratorEmail.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-body truncate" style={{ fontWeight: 600, maxWidth: '180px' }}>
                                                {isMe ? 'Tú' : collaboratorEmail}
                                            </p>
                                            <p className="text-caption text-secondary">Invitado</p>
                                        </div>
                                    </div>
                                    {isOwner && (
                                        <button
                                            onClick={() => store.removeCollaborator(trip.id, collaboratorEmail)}
                                            style={{ padding: '8px', color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                            title="Quitar acceso"
                                        >
                                            <Trash2 size={20} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
