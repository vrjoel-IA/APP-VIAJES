import { useState } from 'react';
import { X, Plus, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useApiIsLoaded } from '@vis.gl/react-google-maps';


// Mapping keywords → category
const KEYWORD_CATEGORY = {
    playa: 'beach', beach: 'beach', costa: 'beach', cala: 'beach', mar: 'beach',
    pueblo: 'culture', ciudad: 'culture', barrio: 'culture', casco: 'culture', villa: 'culture',
    museo: 'culture', monumento: 'culture', catedral: 'culture', iglesia: 'culture', cultura: 'culture',
    comida: 'food', restaurante: 'food', gastronomia: 'food', mercado: 'food',
    excursion: 'nature', naturaleza: 'nature', montaña: 'nature', parque: 'nature',
    senderismo: 'nature', ruta: 'nature', bosque: 'nature', volcan: 'nature', picos: 'nature',
};

function guessCategory(headerLine) {
    const normalized = headerLine.toLowerCase().replace(/[^a-záéíóú\s]/g, '');
    for (const [keyword, cat] of Object.entries(KEYWORD_CATEGORY)) {
        if (normalized.includes(keyword)) return cat;
    }
    return 'other';
}

function parseList(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const entries = [];
    let currentCat = 'other';

    for (const line of lines) {
        // Detect category headers: —, -, #, *
        if (/^[—\-#*]/.test(line)) {
            currentCat = guessCategory(line.replace(/^[—\-#*\s]+/, ''));
        } else {
            entries.push({ name: line, category: currentCat });
        }
    }
    return entries;
}

export default function BulkImportModal({ tripId, addPoi, onClose }) {
    const [text, setText] = useState('');
    const [status, setStatus] = useState('idle');
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [results, setResults] = useState([]);
    const apiIsLoaded = useApiIsLoaded();

    const parsed = text.trim() ? parseList(text) : [];

    const handleImport = async () => {
        if (!parsed.length) return;
        if (!apiIsLoaded) return alert('Google Maps aún cargando. Espera un momento.');

        const ps = new window.google.maps.places.PlacesService(document.createElement('div'));
        setStatus('importing');
        setProgress({ done: 0, total: parsed.length });
        const resultList = [];

        for (let i = 0; i < parsed.length; i++) {
            const entry = parsed[i];
            await new Promise((resolve) => {
                ps.textSearch(
                    { query: `${entry.name}`, language: 'es' },
                    (res, s) => {
                        if (s === window.google.maps.places.PlacesServiceStatus.OK && res[0]) {
                            const p = res[0];
                            // Get full details including photos
                            ps.getDetails(
                                {
                                    placeId: p.place_id,
                                    fields: ['name', 'place_id', 'geometry', 'formatted_address',
                                        'rating', 'user_ratings_total', 'photos',
                                        'opening_hours', 'website', 'formatted_phone_number',
                                        'types', 'price_level'],
                                    language: 'es',
                                },
                                (details, detailStatus) => {
                                    const place = detailStatus === window.google.maps.places.PlacesServiceStatus.OK ? details : p;
                                    const photos = place.photos
                                        ? place.photos.slice(0, 5).map(ph => ph.getUrl({ maxWidth: 800 }))
                                        : [];
                                    addPoi(tripId, {
                                        name: place.name,
                                        placeId: place.place_id,
                                        category: entry.category,
                                        lat: place.geometry.location.lat(),
                                        lng: place.geometry.location.lng(),
                                        address: place.formatted_address || '',
                                        rating: place.rating || null,
                                        userRatingsTotal: place.user_ratings_total || null,
                                        photoUrl: photos[0] || null,
                                        photos,
                                        openingHours: place.opening_hours?.weekday_text || null,
                                        website: place.website || null,
                                        phoneNumber: place.formatted_phone_number || null,
                                        priceLevel: place.price_level ?? null,
                                        types: place.types || [],
                                    });
                                    resultList.push({ name: entry.name, ok: true });
                                    setProgress({ done: i + 1, total: parsed.length });
                                    resolve();
                                }
                            );
                        } else {
                            resultList.push({ name: entry.name, ok: false });
                            setProgress({ done: i + 1, total: parsed.length });
                            resolve();
                        }
                    }
                );
            });
            // Small delay to respect API rate limits
            await new Promise(r => setTimeout(r, 300));
        }

        setResults(resultList);
        setStatus('done');
    };

    return (
        <div className="modal-overlay animate-fade-in" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
                <div className="modal-header">
                    <div>
                        <h2 className="text-subtitle">Importar Lista</h2>
                        <p className="text-caption text-secondary" style={{ marginTop: '2px' }}>
                            Pega tu lista organizada por categorías
                        </p>
                    </div>
                    <button onClick={onClose} className="modal-close"><X size={22} /></button>
                </div>

                {status === 'idle' && (
                    <>
                        <div style={{
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            padding: 'var(--space-md)',
                            marginBottom: 'var(--space-md)',
                            borderLeft: '3px solid var(--color-primary)'
                        }}>
                            <p className="text-caption text-secondary" style={{ lineHeight: 1.7 }}>
                                <strong>Formato soportado:</strong><br />
                                <code style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                                    —Playas<br />
                                    Costa de Adeje<br />
                                    Playa de los Muertos<br />
                                    <br />
                                    —Excursion<br />
                                    Teide
                                </code>
                            </p>
                        </div>

                        <textarea
                            className="input-field"
                            rows={10}
                            style={{ padding: '16px', resize: 'vertical', fontFamily: 'monospace', fontSize: '14px' }}
                            placeholder={"—Playas\nCosta de Adeje\nPlaya de los Muertos\n\n—Pueblos\nMasca\nRonda\n\n—Excursion\nTeide"}
                            value={text}
                            onChange={e => setText(e.target.value)}
                        />

                        {parsed.length > 0 && (
                            <div style={{ margin: 'var(--space-md) 0', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)' }}>
                                <span className="text-caption" style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
                                    ✓ Se detectaron {parsed.length} lugares
                                </span>
                            </div>
                        )}

                        <button
                            className="btn btn-accent btn-full"
                            style={{ marginTop: 'var(--space-md)' }}
                            onClick={handleImport}
                            disabled={!parsed.length}
                        >
                            <Plus size={16} /> Importar {parsed.length} lugar{parsed.length !== 1 ? 'es' : ''}
                        </button>
                    </>
                )}

                {status === 'importing' && (
                    <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
                        <Loader2 size={40} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                        <h3 className="text-subtitle" style={{ marginBottom: '8px' }}>Buscando lugares...</h3>
                        <p className="text-body text-secondary">{progress.done} de {progress.total}</p>
                        <div style={{ width: '100%', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-full)', height: '8px', margin: '16px 0', overflow: 'hidden' }}>
                            <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 'var(--radius-full)', transition: 'width 0.3s ease' }} />
                        </div>
                    </div>
                )}

                {status === 'done' && (
                    <div style={{ paddingTop: 'var(--space-md)' }}>
                        <h3 className="text-subtitle" style={{ marginBottom: 'var(--space-md)' }}>
                            ✅ Importación completada
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--space-lg)' }}>
                            {results.map((r, i) => (
                                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    {r.ok
                                        ? <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                                        : <AlertCircle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                    }
                                    <span className="text-body" style={{ color: r.ok ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                                        {r.name} {!r.ok && '(no encontrado)'}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <button className="btn btn-primary btn-full" onClick={onClose}>Cerrar</button>
                    </div>
                )}
            </div>
        </div>
    );
}
