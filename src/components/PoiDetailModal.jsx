import { useState, useEffect, useRef } from 'react';
import {
    X, MapPin, Star, Navigation, Phone, Globe, Clock,
    ChevronLeft, ChevronRight, Trash2, ExternalLink,
    Heart, CheckCircle2, Ban, Pencil, Timer, Sun, Circle,
    Map as MapIconLucide, Car, Footprints, Bus,
    FileText, Sparkles, Eye, Lightbulb, Ticket, Accessibility, AlertCircle
} from 'lucide-react';
import { useApiIsLoaded } from '@vis.gl/react-google-maps';
import { CATEGORIES, CATEGORY_MAP, formatDuration, getPlaceholderImage } from '../utils/constants';
import { parseNotes } from '../lib/notesFormat';
import { computeTravel, findDistance } from '../lib/distances';

const PRICE_LABELS = ['Gratis', 'Económico', 'Moderado', 'Caro', 'Muy caro'];

// Iconos por tipo de bloque de notas (los nombres los produce notesFormat.js).
const NOTE_ICONS = {
    FileText, Sparkles, Eye, Lightbulb, Clock, Ticket, Timer, Sun, Accessibility, AlertCircle,
};

// Los cuatro estados posibles de un lugar (mutuamente excluyentes).
const ESTADOS = [
    { key: 'imprescindible', label: 'Imprescindible', icon: Heart, color: 'var(--color-primary)' },
    { key: 'yaVisitado', label: 'Visitado', icon: CheckCircle2, color: 'var(--color-accent)' },
    { key: 'descartado', label: 'Descartado', icon: Ban, color: 'var(--color-danger)' },
    { key: 'sin_marcar', label: 'Sin marcar', icon: Circle, color: 'var(--text-tertiary)' },
];

// Devuelve el estado actual del POI a partir de sus booleanos.
function estadoActual(poi) {
    if (poi.imprescindible) return 'imprescindible';
    if (poi.yaVisitado) return 'yaVisitado';
    if (poi.descartado) return 'descartado';
    return 'sin_marcar';
}

// Convierte un estado elegido en el conjunto de campos a persistir (exclusión mutua).
// `descartado` desactiva el lugar; cualquier otro estado lo reactiva.
function estadoUpdates(estado) {
    const base = { imprescindible: false, yaVisitado: false, descartado: false };
    if (estado === 'imprescindible') return { ...base, imprescindible: true, isActive: true };
    if (estado === 'yaVisitado') return { ...base, yaVisitado: true, isActive: true };
    if (estado === 'descartado') return { ...base, descartado: true, isActive: false };
    return { ...base, isActive: true }; // sin_marcar
}

export default function PoiDetailModal({ poi, trip, onClose, onDelete, onUpdate, onShowOnMap, onSaveDistances }) {
    const [photoIdx, setPhotoIdx] = useState(0);
    const [showHours, setShowHours] = useState(false);
    const [isEditingCategory, setIsEditingCategory] = useState(false);
    const [editing, setEditing] = useState(false);
    const canEdit = typeof onUpdate === 'function';
    const apiIsLoaded = useApiIsLoaded();
    const computedFor = useRef(null); // clave (accId+poiId) ya calculada, evita repetir

    const photos = poi.photos?.length ? poi.photos : [poi.photoUrl || getPlaceholderImage(poi.name)];
    const catInfo = CATEGORY_MAP[poi.category] || { emoji: '📍', label: 'Lugar', color: '#6b7280' };
    const notesBlocks = editing ? [] : parseNotes(poi.notas);

    // Base activa = campamento base fijado, o el primer alojamiento activo. Es el ORIGEN
    // dinámico: si el usuario cambia de alojamiento, cambian los tiempos, NO la descripción.
    const activeBase = trip?.selectedAccommodation
        ? trip.accommodations?.find(a => a.id === trip.selectedAccommodation)
        : trip?.accommodations?.find(a => a.isActive !== false);
    const dist = findDistance(trip, activeBase?.id, poi.id);

    // Cálculo perezoso de andando/transporte (y coche si faltara) al abrir el detalle.
    // Se cachea en el viaje vía onSaveDistances; solo se pide lo que no esté ya guardado.
    useEffect(() => {
        if (!apiIsLoaded || !onSaveDistances || !activeBase || poi.lat == null) return;
        const key = `${activeBase.id}|${poi.id}`;
        if (computedFor.current === key) return;

        const rec = findDistance(trip, activeBase.id, poi.id) || {};
        const needs = [];
        if (rec.walkingDurationSeconds == null) needs.push('WALKING');
        if (rec.transitDurationSeconds == null) needs.push('TRANSIT');
        if (rec.drivingDurationSeconds == null) needs.push('DRIVING');
        if (needs.length === 0) { computedFor.current = key; return; }
        computedFor.current = key;

        let cancelled = false;
        (async () => {
            const patch = { accommodationId: activeBase.id, poiId: poi.id };
            for (const mode of needs) {
                const r = await computeTravel(activeBase, poi, mode);
                if (r) {
                    if (mode === 'WALKING') patch.walkingDurationSeconds = r.durationSec;
                    else if (mode === 'TRANSIT') patch.transitDurationSeconds = r.durationSec;
                    else { patch.drivingDurationSeconds = r.durationSec; patch.distanceMeters = r.distanceMeters; }
                }
            }
            if (!cancelled && Object.keys(patch).length > 2) onSaveDistances([patch]);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiIsLoaded, activeBase?.id, poi.id, poi.lat, onSaveDistances]);

    const mapsUrl = `https://www.google.com/maps/search/?api=1&query_place_id=${poi.placeId || ''}&query=${encodeURIComponent(poi.name)}`;
    // Metros a texto corto (línea recta o de Google): 850 m / 12,3 km.
    const fmtDist = (m) => (m == null ? null : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

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
                                    // Cambio manual: fija la categoría (categoryLocked) para que la
                                    // reclasificación automática no la vuelva a tocar.
                                    if (onUpdate) onUpdate({ category: e.target.value, categoryLocked: true });
                                    setIsEditingCategory(false);
                                }}
                                style={{
                                    fontSize: '13px', padding: '4px 10px', borderRadius: 'var(--radius-full)',
                                    background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)'
                                }}
                            >
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

                    {/* Estado del lugar: control segmentado mutuamente excluyente (4 estados). */}
                    {canEdit && (() => {
                        const estado = estadoActual(poi);
                        return (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                                {ESTADOS.map(({ key, label, icon: Icon, color }) => {
                                    const active = estado === key;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => onUpdate(estadoUpdates(key))}
                                            aria-pressed={active}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', minHeight: 40,
                                                borderRadius: 'var(--radius-full)', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                                                border: active ? 'none' : '1px solid var(--border-color)',
                                                background: active ? color : 'var(--bg-secondary)',
                                                color: active ? 'white' : 'var(--text-secondary)',
                                                WebkitTapHighlightColor: 'transparent',
                                            }}
                                        >
                                            <Icon size={15} fill={active && Icon === Heart ? 'white' : 'none'} /> {label}
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    {/* Datos de la investigación (municipio, duración, mejor momento, notas) */}
                    {(poi.municipio || poi.duracionEstimadaMin || poi.mejorMomento || poi.notas || canEdit) && (
                        <div className="card" style={{ background: 'var(--bg-secondary)', marginBottom: 16, padding: 'var(--space-md)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: editing ? 12 : ((poi.municipio || poi.duracionEstimadaMin || poi.mejorMomento || poi.notas) ? 10 : 0) }}>
                                <span className="text-caption" style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>Notas del viaje</span>
                                {canEdit && (
                                    <button onClick={() => setEditing(e => !e)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 700, fontSize: 12 }}>
                                        <Pencil size={13} /> {editing ? 'Listo' : 'Editar'}
                                    </button>
                                )}
                            </div>

                            {editing ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <div style={{ flex: 1 }}>
                                            <label className="field-label">Municipio</label>
                                            <input className="input-field" style={{ padding: '10px 12px' }} value={poi.municipio || ''} onChange={e => onUpdate({ municipio: e.target.value })} placeholder="Tarifa" />
                                        </div>
                                        <div style={{ width: 130 }}>
                                            <label className="field-label">Duración (min)</label>
                                            <input className="input-field" type="number" min="0" step="15" style={{ padding: '10px 12px' }} value={poi.duracionEstimadaMin ?? ''} onChange={e => onUpdate({ duracionEstimadaMin: e.target.value === '' ? null : parseInt(e.target.value, 10) })} placeholder="120" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="field-label">Mejor momento</label>
                                        <input className="input-field" style={{ padding: '10px 12px' }} value={poi.mejorMomento || ''} onChange={e => onUpdate({ mejorMomento: e.target.value })} placeholder="Mañana. Evitar levante fuerte." />
                                    </div>
                                    <div>
                                        <label className="field-label">Notas</label>
                                        <textarea className="input-field" rows={3} style={{ padding: '10px 12px', resize: 'vertical' }} value={poi.notas || ''} onChange={e => onUpdate({ notas: e.target.value })} placeholder="Aparcamiento, consejos, avisos..." />
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {poi.municipio && (
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                            <MapPin size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                            <span className="text-body text-secondary">{poi.municipio}</span>
                                        </div>
                                    )}
                                    {poi.duracionEstimadaMin > 0 && (
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                            <Timer size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                            <span className="text-body text-secondary">{formatDuration(poi.duracionEstimadaMin * 60)} de visita estimada</span>
                                        </div>
                                    )}
                                    {poi.mejorMomento && (
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                            <Sun size={15} style={{ color: 'var(--color-gold)', flexShrink: 0, marginTop: 2 }} />
                                            <span className="text-body text-secondary">{poi.mejorMomento}</span>
                                        </div>
                                    )}
                                    {notesBlocks.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 2 }}>
                                            {notesBlocks.map((block, i) => {
                                                const BlockIcon = NOTE_ICONS[block.icon] || FileText;
                                                return (
                                                    <div key={block.key + i}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                            <BlockIcon size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                                            <span className="text-caption" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{block.label}</span>
                                                        </div>
                                                        <p className="text-body text-secondary" style={{ lineHeight: 1.55, whiteSpace: 'pre-wrap', margin: 0 }}>{block.body}</p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {!poi.municipio && !poi.duracionEstimadaMin && !poi.mejorMomento && notesBlocks.length === 0 && (
                                        <p className="text-caption text-tertiary">Sin notas todavía. Pulsa "Editar" para añadirlas.</p>
                                    )}
                                </div>
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

                        {/* Distancia y tiempos desde el alojamiento (ORIGEN DINÁMICO). */}
                        {activeBase && poi.lat != null && (
                            <div className="card" style={{ background: 'var(--bg-secondary)', padding: 'var(--space-md)', gap: 10, display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                                    <span className="text-caption" style={{ fontWeight: 800, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                        <Navigation size={13} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                        <span className="truncate">Desde {activeBase.name}</span>
                                    </span>
                                    {fmtDist(dist?.distanceMeters) && (
                                        <span className="text-caption text-tertiary" style={{ flexShrink: 0 }}>{fmtDist(dist.distanceMeters)}</span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {[
                                        { Icon: Car, sec: dist?.drivingDurationSeconds, label: 'Coche' },
                                        { Icon: Footprints, sec: dist?.walkingDurationSeconds, label: 'A pie' },
                                        { Icon: Bus, sec: dist?.transitDurationSeconds, label: 'Transporte' },
                                    ].map((m) => (
                                        <div key={m.label} title={m.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 'var(--radius-full)', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                                            <m.Icon size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                            <span className="text-caption" style={{ fontWeight: 700, color: m.sec != null ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                                                {m.sec != null ? formatDuration(m.sec) : (apiIsLoaded ? '…' : '—')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
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

                        {(poi.reservas || poi.reservaUrl || poi.requiereCita) && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                <Ticket size={16} style={{ color: 'var(--color-gold)', flexShrink: 0, marginTop: 2 }} />
                                <span className="text-body text-secondary">
                                    {poi.requiereCita ? 'Requiere cita previa. ' : ''}
                                    {typeof poi.reservas === 'string' ? poi.reservas : (poi.reservas ? 'Se recomienda reservar. ' : '')}
                                    {poi.reservaUrl && (
                                        <a href={poi.reservaUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>Reservar aquí</a>
                                    )}
                                </span>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Ver en NUESTRO mapa: centra, selecciona el marcador y abre el mapa interno. */}
                        {typeof onShowOnMap === 'function' && poi.lat != null && (
                            <button
                                type="button"
                                className="btn btn-primary"
                                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                                onClick={() => { onShowOnMap(poi); onClose(); }}
                            >
                                <MapIconLucide size={16} /> Ver en nuestro mapa
                            </button>
                        )}
                        <div style={{ display: 'flex', gap: 10 }}>
                            <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-outline"
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
                                <ExternalLink size={16} /> Abrir en Google Maps
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
