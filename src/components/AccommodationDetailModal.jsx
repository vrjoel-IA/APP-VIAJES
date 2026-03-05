import { X, MapPin, Navigation, Phone, Globe, Star, ExternalLink } from 'lucide-react';
import { getPlaceholderImage } from '../utils/constants';

export default function AccommodationDetailModal({ acc, onClose }) {
    if (!acc) return null;

    const mapsUrl = `https://www.google.com/maps/search/?api=1&query_place_id=${acc.placeId || ''}&query=${encodeURIComponent(acc.name)}`;
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${acc.lat},${acc.lng}`;

    return (
        <div className="modal-overlay animate-fade-in" onClick={onClose}>
            <div
                className="modal-content poi-detail-modal"
                onClick={e => e.stopPropagation()}
                style={{ padding: 0, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            >
                {/* Hero Image */}
                <div style={{ position: 'relative', width: '100%', height: '220px', background: '#1a1a2e', flexShrink: 0 }}>
                    <img
                        src={acc.photoUrl || getPlaceholderImage(acc.name)}
                        alt={acc.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={e => { e.target.src = getPlaceholderImage(acc.name); }}
                    />
                    <button
                        onClick={onClose}
                        style={{
                            position: 'absolute', top: 10, right: 10,
                            background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
                            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', cursor: 'pointer',
                        }}
                    ><X size={18} /></button>
                    {/* Badge */}
                    <div style={{
                        position: 'absolute', bottom: 12, left: 12,
                        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                        color: 'white', padding: '4px 12px', borderRadius: 20, fontSize: '12px', fontWeight: 700,
                    }}>
                        🏨 Alojamiento
                    </div>
                </div>

                {/* Content */}
                <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--space-lg)' }}>
                    <h2 className="text-title" style={{ marginBottom: 8 }}>{acc.name}</h2>

                    {acc.rating && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                            {[1, 2, 3, 4, 5].map(s => (
                                <Star key={s} size={14}
                                    fill={s <= Math.round(acc.rating) ? '#f5a623' : 'none'}
                                    color='#f5a623'
                                />
                            ))}
                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#f5a623' }}>{acc.rating}</span>
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                        {acc.address && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <MapPin size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                                <span className="text-body text-secondary">{acc.address}</span>
                            </div>
                        )}
                        {acc.phone && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <Phone size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                <a href={`tel:${acc.phone}`} style={{ color: 'var(--color-primary)', fontSize: '14px' }}>{acc.phone}</a>
                            </div>
                        )}
                        {acc.website && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <Globe size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                <a href={acc.website} target="_blank" rel="noopener noreferrer"
                                    style={{ color: 'var(--color-primary)', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {acc.website.replace(/^https?:\/\//, '').split('/')[0]}
                                </a>
                            </div>
                        )}
                    </div>

                    {/* CTA Buttons */}
                    <div style={{ display: 'flex', gap: 10 }}>
                        <a
                            href={directionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                            style={{ flex: 1, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                            <Navigation size={16} /> Cómo llegar
                        </a>
                        <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-outline"
                            style={{ flex: 1, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                            <ExternalLink size={16} /> Ver en Maps
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
