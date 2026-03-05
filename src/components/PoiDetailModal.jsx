import { useState } from 'react';
import {
    X, MapPin, Star, Navigation, Phone, Globe, Clock,
    ChevronLeft, ChevronRight, Trash2, ExternalLink
} from 'lucide-react';
import { CATEGORIES, CATEGORY_MAP, formatDuration, getPlaceholderImage } from '../utils/constants';

const PRICE_LABELS = ['Gratis', 'Económico', 'Moderado', 'Caro', 'Muy caro'];

export default function PoiDetailModal({ poi, trip, onClose, onDelete, onUpdate }) {
    const [photoIdx, setPhotoIdx] = useState(0);
    const [showHours, setShowHours] = useState(false);
    const [isEditingCategory, setIsEditingCategory] = useState(false);

    const photos = poi.photos?.length ? poi.photos : [poi.photoUrl || getPlaceholderImage(poi.name)];
    const catInfo = CATEGORY_MAP[poi.category] || { emoji: '📍', label: 'Lugar', color: '#6b7280' };

    const dist = trip.selectedAccommodation
        ? trip.distances?.find(d => d.accommodationId === trip.selectedAccommodation && d.poiId === poi.id)
        : null;

    const mapsUrl = `https://www.google.com/maps/search/?api=1&query_place_id=${poi.placeId || ''}&query=${encodeURIComponent(poi.name)}`;

    return (
        <div className="modal-overlay animate-fade-in" onClick={onClose}>
            <div
                className="modal-content poi-detail-modal"
                onClick={e => e.stopPropagation()}
                style={{ padding: 0, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            >
                {/* === PHOTO GALLERY === */}
                <div style={{ position: 'relative', width: '100%', height: '240px', background: '#1a1a2e', flexShrink: 0 }}>
                    <img
                        src={photos[photoIdx]}
                        alt={poi.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={e => { e.target.src = getPlaceholderImage(poi.name); }}
                    />

                    {/* Photo nav */}
                    {photos.length > 1 && (
                        <>
                            <button
                                onClick={() => setPhotoIdx(p => (p - 1 + photos.length) % photos.length)}
                                style={{
                                    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                                    background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
                                    width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'white', cursor: 'pointer',
                                }}
                            ><ChevronLeft size={18} /></button>
                            <button
                                onClick={() => setPhotoIdx(p => (p + 1) % photos.length)}
                                style={{
                                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                                    background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
                                    width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: 'white', cursor: 'pointer',
                                }}
                            ><ChevronRight size={18} /></button>

                            {/* Dots */}
                            <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>
                                {photos.map((_, i) => (
                                    <div
                                        key={i}
                                        onClick={() => setPhotoIdx(i)}
                                        style={{
                                            width: i === photoIdx ? 18 : 6, height: 6, borderRadius: 3,
                                            background: i === photoIdx ? 'white' : 'rgba(255,255,255,0.5)',
                                            transition: 'all 0.2s', cursor: 'pointer',
                                        }}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {/* Close / Delete buttons */}
                    <button
                        onClick={onClose}
                        style={{
                            position: 'absolute', top: 10, right: 10,
                            background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
                            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', cursor: 'pointer',
                        }}
                    ><X size={18} /></button>
                    <button
                        onClick={() => {
                            if (confirm(`¿Eliminar ${poi.name}?`)) onDelete();
                        }}
                        style={{
                            position: 'absolute', top: 10, left: 10,
                            background: 'rgba(239,68,68,0.8)', border: 'none', borderRadius: '50%',
                            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', cursor: 'pointer',
                        }}
                    ><Trash2 size={16} /></button>

                    {/* Photo counter */}
                    {photos.length > 1 && (
                        <div style={{
                            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
                            background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: '12px', fontWeight: 600,
                            padding: '3px 10px', borderRadius: 20,
                        }}>
                            {photoIdx + 1} / {photos.length}
                        </div>
                    )}
                </div>

                {/* === CONTENT === */}
                <div style={{ overflowY: 'auto', flex: 1, padding: 'var(--space-lg)' }}>

                    {/* Category + Rating */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        {isEditingCategory ? (
                            <select
                                className="styled-select"
                                autoFocus
                                value={poi.category}
                                onBlur={() => setIsEditingCategory(false)}
                                onChange={(e) => {
                                    if (onUpdate) onUpdate({ category: e.target.value });
                                    setIsEditingCategory(false);
                                }}
                                style={{
                                    fontSize: '13px', padding: '4px 10px', borderRadius: 'var(--radius-full)',
                                    background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)'
                                }}
                            >
                                <option value="other">📌 Otro</option>
                                {CATEGORIES.map(c => (
                                    <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                                ))}
                            </select>
                        ) : (
                            <button
                                className="chip"
                                onClick={() => setIsEditingCategory(true)}
                                style={{
                                    background: catInfo.color + '20', color: catInfo.color, fontSize: '12px', padding: '4px 10px',
                                    border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                                }}
                                title="Cambiar categoría"
                            >
                                {catInfo.emoji} {catInfo.label} <span style={{ fontSize: '10px', opacity: 0.7 }}>▾</span>
                            </button>
                        )}
                        {poi.priceLevel != null && (
                            <span className="chip" style={{ fontSize: '12px', padding: '4px 10px' }}>
                                {'€'.repeat(poi.priceLevel + 1)} {PRICE_LABELS[poi.priceLevel]}
                            </span>
                        )}
                    </div>

                    <h2 className="text-title" style={{ marginBottom: 4 }}>{poi.name}</h2>

                    {/* Rating row */}
                    {poi.rating && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                            {[1, 2, 3, 4, 5].map(s => (
                                <Star
                                    key={s}
                                    size={14}
                                    fill={s <= Math.round(poi.rating) ? '#f5a623' : 'none'}
                                    color='#f5a623'
                                />
                            ))}
                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#f5a623' }}>{poi.rating}</span>
                            {poi.userRatingsTotal && (
                                <span className="text-caption text-tertiary">({poi.userRatingsTotal.toLocaleString()} reseñas)</span>
                            )}
                        </div>
                    )}

                    {/* Data rows */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                        {poi.address && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <MapPin size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                                <span className="text-body text-secondary">{poi.address}</span>
                            </div>
                        )}

                        {dist && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <Navigation size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                <span className="text-body" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
                                    {formatDuration(dist.drivingDurationSeconds)} desde tu alojamiento
                                </span>
                            </div>
                        )}

                        {poi.phoneNumber && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <Phone size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                <a href={`tel:${poi.phoneNumber}`} className="text-body" style={{ color: 'var(--color-primary)' }}>
                                    {poi.phoneNumber}
                                </a>
                            </div>
                        )}

                        {poi.website && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <Globe size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                <a href={poi.website} target="_blank" rel="noopener noreferrer"
                                    className="text-body" style={{ color: 'var(--color-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
                                >
                                    {poi.website.replace(/^https?:\/\//, '').split('/')[0]}
                                </a>
                            </div>
                        )}

                        {poi.openingHours && poi.openingHours.length > 0 && (
                            <div>
                                <button
                                    onClick={() => setShowHours(h => !h)}
                                    style={{
                                        display: 'flex', gap: 10, alignItems: 'center',
                                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                    }}
                                >
                                    <Clock size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                    <span className="text-body" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                                        Ver horarios {showHours ? '▲' : '▼'}
                                    </span>
                                </button>
                                {showHours && (
                                    <div style={{ marginTop: 8, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {poi.openingHours.map((line, i) => (
                                            <span key={i} className="text-caption text-secondary">{line}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Photo thumbnails */}
                    {photos.length > 1 && (
                        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 16 }}>
                            {photos.map((url, i) => (
                                <img
                                    key={i}
                                    src={url}
                                    alt=""
                                    onClick={() => setPhotoIdx(i)}
                                    style={{
                                        width: 72, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0,
                                        cursor: 'pointer',
                                        outline: i === photoIdx ? '3px solid var(--color-primary)' : '2px solid transparent',
                                        opacity: i === photoIdx ? 1 : 0.7,
                                        transition: 'all 0.15s',
                                    }}
                                    onError={e => { e.target.style.display = 'none'; }}
                                />
                            ))}
                        </div>
                    )}

                    {/* CTA Buttons */}
                    <div style={{ display: 'flex', gap: 10 }}>
                        <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                            style={{ flex: 1, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                            <Navigation size={16} /> Cómo llegar
                        </a>
                        <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(poi.name)}`}
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
