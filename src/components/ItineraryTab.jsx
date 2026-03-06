import { useState } from 'react';
import {
    Plus, Trash2, Navigation, Clock, CheckCircle2, Utensils,
    Map, ExternalLink, ChevronUp, ChevronDown, Edit3, X
} from 'lucide-react';
import { useApiIsLoaded } from '@vis.gl/react-google-maps';
import { formatDuration } from '../utils/constants';
import PoiDetailModal from './PoiDetailModal';

// Visit duration in hours by category (default estimates)
const VISIT_DURATION = {
    beach: 2.5,
    culture: 1.5,
    nature: 3.5,
    food: 1,
    other: 1,
};

function addMinutes(timeStr, minutes) {
    const [h, m] = timeStr.split(':').map(Number);
    const totalMins = h * 60 + m + Math.round(minutes);
    const newH = Math.floor(totalMins / 60) % 24;
    const newM = totalMins % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function timeToMins(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function categoryEmoji(cat) {
    const map = { beach: '🏖️', culture: '🏛️', food: '🍽️', nature: '🌿', other: '📍' };
    return map[cat] || '📍';
}

// Build Google Maps directions deep-link for a full itinerary
function buildMapsUrl(startLoc, optimizedPois, endLoc) {
    if (!startLoc || !endLoc || !optimizedPois?.length) return null;
    const origin = encodeURIComponent(`${startLoc.lat},${startLoc.lng}`);
    const destination = encodeURIComponent(`${endLoc.lat},${endLoc.lng}`);
    const waypoints = optimizedPois.map(p => encodeURIComponent(`${p.lat},${p.lng}`)).join('|');
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=driving`;
}

export default function ItineraryTab({ trip, store }) {
    const [editingDay, setEditingDay] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [editingItinerary, setEditingItinerary] = useState(null); // id of itinerary being edited
    const [poiDetail, setPoiDetail] = useState(null);
    const apiIsLoaded = useApiIsLoaded();

    // Form state
    const [title, setTitle] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [startId, setStartId] = useState('');
    const [endId, setEndId] = useState('');
    const [selectedPois, setSelectedPois] = useState([]);
    const [visitHours, setVisitHours] = useState({});
    const [travelModes, setTravelModes] = useState({});
    const [mealTypes, setMealTypes] = useState({}); // poiId -> 'Almuerzo' | 'Cena'

    // Edit mode state
    const [editTimeline, setEditTimeline] = useState(null); // copy of timeline being edited

    const itineraries = trip.itineraries || [];
    const allLocations = [
        ...trip.accommodations.filter(a => a.isActive !== false).map(a => ({ ...a, type: 'accommodation', label: `🏨 ${a.name}` })),
        ...trip.pois.filter(p => p.isActive !== false).map(p => ({ ...p, type: 'poi', label: `📍 ${p.name}` }))
    ];

    const togglePoiSelection = (poiId) => {
        setSelectedPois(prev =>
            prev.includes(poiId) ? prev.filter(id => id !== poiId) : [...prev, poiId]
        );
    };

    const handleCreateNew = () => {
        setEditingDay(Date.now().toString());
        setTitle(`Día ${itineraries.length + 1}`);
        setStartId(trip.selectedAccommodation || '');
        setEndId(trip.selectedAccommodation || '');
        setSelectedPois([]);
        setVisitHours({});
        setTravelModes({});
        setMealTypes({});
        setStartTime('09:00');
        setEditingItinerary(null);
    };

    const handleEditExisting = (itinerary) => {
        setEditingItinerary(itinerary.id);
        setEditTimeline(JSON.parse(JSON.stringify(itinerary.timeline || [])));
    };

    const saveEditedItinerary = (itineraryId) => {
        const idx = itineraries.findIndex(i => i.id === itineraryId);
        if (idx < 0) return;
        const updated = [...itineraries];
        updated[idx] = { ...updated[idx], timeline: editTimeline };
        store.updateTrip(trip.id, { itineraries: updated });
        setEditingItinerary(null);
        setEditTimeline(null);
    };

    // Recalculate timeline times starting from a given index.
    // After the anchor step at anchorIdx (which keeps its time),
    // propagates visit durations and transport times forward.
    const recalcTimesFrom = (timeline, anchorIdx) => {
        const updated = [...timeline];
        let currentTime = updated[anchorIdx].time;

        for (let i = anchorIdx; i < updated.length; i++) {
            const step = updated[i];
            // Set arrival time for this step
            updated[i] = { ...step, time: currentTime };

            const visitMins = (step.visitHours || 0) * 60;
            const mealMins = step.type === 'meal'
                ? (step.mealTime === 'Cena' ? 90 : 75)
                : 0;
            const travelMins = step.type === 'departure' && step.leg
                ? step.leg.durationMins
                : (step.leg?.durationMins || 0);

            if (step.type === 'poi') {
                currentTime = addMinutes(currentTime, visitMins || 90);
                // Add travel to next if available
                const nextLeg = updated[i + 1]?.leg;
                if (nextLeg) currentTime = addMinutes(currentTime, nextLeg.durationMins);
            } else if (step.type === 'meal') {
                currentTime = addMinutes(currentTime, mealMins);
            } else if (step.type === 'departure') {
                currentTime = addMinutes(currentTime, travelMins);
            }
            // arrival stays as is (last step)
        }
        return updated;
    };

    const moveStep = (idx, direction) => {
        const newTimeline = [...editTimeline];
        const targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= newTimeline.length) return;
        // Swap the two steps
        [newTimeline[idx], newTimeline[targetIdx]] = [newTimeline[targetIdx], newTimeline[idx]];
        // Find the first affected index (the lower of the two)
        const anchorIdx = Math.min(idx, targetIdx);
        const recalced = recalcTimesFrom(newTimeline, anchorIdx);
        setEditTimeline(recalced);
    };

    const updateStepTime = (idx, newTime) => {
        const newTimeline = [...editTimeline];
        newTimeline[idx] = { ...newTimeline[idx], time: newTime };
        // Recalculate all steps AFTER this one
        const recalced = recalcTimesFrom(newTimeline, idx);
        setEditTimeline(recalced);
    };

    const deleteStep = (idx) => {
        setEditTimeline(prev => prev.filter((_, i) => i !== idx));
    };

    const deleteItinerary = (id) => {
        if (!confirm('¿Eliminar este itinerario?')) return;
        store.updateTrip(trip.id, {
            itineraries: itineraries.filter(i => i.id !== id)
        });
    };

    const generateRoute = async () => {
        if (!startId || !endId || selectedPois.length === 0) {
            return alert('Selecciona punto de salida, llegada y al menos 1 lugar.');
        }
        if (!apiIsLoaded) return alert('Google Maps aún no ha cargado. Espera un momento.');

        setGenerating(true);

        const startLoc = allLocations.find(l => l.id === startId);
        const endLoc = allLocations.find(l => l.id === endId);
        const wps = selectedPois.map(id => trip.pois.find(p => p.id === id)).filter(Boolean);

        const ds = new window.google.maps.DirectionsService();
        const ps = new window.google.maps.places.PlacesService(document.createElement('div'));

        const foodWps = wps.filter(w => w.category === 'food');
        const routeWps = wps.filter(w => w.category !== 'food');

        const lunchPoi = foodWps.find(w => mealTypes[w.id] === 'Almuerzo') || foodWps[0];
        const dinnerPoi = foodWps.find(w => mealTypes[w.id] === 'Cena' || (w !== lunchPoi)) || (lunchPoi ? foodWps[1] : foodWps[0]);

        try {
            let optimizedPois = [];
            if (routeWps.length > 0) {
                const routeResult = await new Promise((resolve, reject) => {
                    ds.route({
                        origin: { lat: startLoc.lat, lng: startLoc.lng },
                        destination: { lat: endLoc.lat, lng: endLoc.lng },
                        waypoints: routeWps.map(w => ({ location: { lat: w.lat, lng: w.lng }, stopover: true })),
                        optimizeWaypoints: true,
                        travelMode: 'DRIVING'
                    }, (res, status) => {
                        if (status === 'OK') resolve(res);
                        else reject(new Error(status));
                    });
                });
                const order = routeResult.routes[0].waypoint_order;
                optimizedPois = order.map(i => routeWps[i]);
            }

            // Estimate times for sequence building
            let currentMins = timeToMins(startTime);
            const sequence = [];
            let lunchInserted = false;
            let dinnerInserted = false;

            for (let i = 0; i < optimizedPois.length; i++) {
                const poi = optimizedPois[i];
                if (!lunchInserted && lunchPoi && currentMins >= 12 * 60 + 30) {
                    sequence.push({ ...lunchPoi, isMeal: true, mealTime: 'Almuerzo' });
                    currentMins += 90;
                    lunchInserted = true;
                }
                if (!dinnerInserted && dinnerPoi && currentMins >= 19 * 60 + 30) {
                    sequence.push({ ...dinnerPoi, isMeal: true, mealTime: 'Cena' });
                    currentMins += 90;
                    dinnerInserted = true;
                }
                sequence.push(poi);
                currentMins += ((visitHours[poi.id] || VISIT_DURATION[poi.category] || 1.5) * 60) + 15;
            }

            if (!lunchInserted && lunchPoi) sequence.push({ ...lunchPoi, isMeal: true, mealTime: 'Almuerzo' });
            if (!dinnerInserted && dinnerPoi) sequence.push({ ...dinnerPoi, isMeal: true, mealTime: 'Cena' });

            const placesSequence = [...sequence, { id: 'end', lat: endLoc.lat, lng: endLoc.lng, isEnd: true }];

            // Calculate exact travel legs for the final sequence
            const legs = [];
            let currentLoc = { lat: startLoc.lat, lng: startLoc.lng };

            for (const place of placesSequence) {
                const mode = place.isEnd ? 'DRIVING' : (travelModes[place.id] || 'DRIVING');
                try {
                    const legRes = await new Promise(resolve => {
                        ds.route({
                            origin: currentLoc,
                            destination: { lat: place.lat, lng: place.lng },
                            travelMode: mode
                        }, (res, status) => {
                            if (status === 'OK') resolve(res.routes[0].legs[0]);
                            else resolve(null);
                        });
                    });

                    if (legRes) {
                        legs.push({
                            durationText: legRes.duration.text,
                            distanceText: legRes.distance.text,
                            durationSec: legRes.duration.value,
                            durationMins: legRes.duration.value / 60,
                            mode: mode,
                            icon: mode === 'WALKING' ? '🚶' : mode === 'TRANSIT' ? '🚌' : mode === 'BICYCLING' ? '🚲' : '🚗'
                        });
                    } else throw new Error();
                } catch (e) {
                    legs.push({ durationText: '10 min', distanceText: '---', durationSec: 600, durationMins: 10, mode: mode, icon: '🚗' });
                }
                currentLoc = { lat: place.lat, lng: place.lng };
                await new Promise(r => setTimeout(r, 200));
            }

            let currentTime = startTime;
            const timeline = [];

            timeline.push({ type: 'departure', time: currentTime, name: startLoc?.name || 'Punto de partida', icon: '🚗' });
            currentTime = addMinutes(currentTime, legs[0].durationMins);

            let hasLunch = !!lunchPoi;
            let hasDinner = !!dinnerPoi;

            for (let i = 0; i < sequence.length; i++) {
                const place = sequence[i];

                if (place.isMeal) {
                    timeline.push({
                        type: 'meal',
                        mealTime: place.mealTime,
                        time: currentTime,
                        name: `🍴 ${place.name}`,
                        rating: place.rating,
                        vicinity: place.address || place.vicinity || '',
                        lat: place.lat,
                        lng: place.lng,
                        icon: '🍴',
                        leg: legs[i + 1],
                    });
                    currentTime = addMinutes(currentTime, place.mealTime === 'Cena' ? 90 : 75);
                    if (legs[i + 1]) currentTime = addMinutes(currentTime, legs[i + 1].durationMins);
                } else {
                    const visitMins = (visitHours[place.id] || VISIT_DURATION[place.category] || 1.5) * 60;
                    timeline.push({
                        type: 'poi',
                        time: currentTime,
                        name: place.name,
                        category: place.category,
                        visitHours: visitHours[place.id] || VISIT_DURATION[place.category] || 1.5,
                        icon: categoryEmoji(place.category),
                        lat: place.lat,
                        lng: place.lng,
                        poiId: place.id,
                        rating: place.rating,
                        visitDurationText: visitHours[place.id] ? `${visitHours[place.id]}h visita` : `~${VISIT_DURATION[place.category] || 1.5}h estimada`,
                        leg: legs[i + 1],
                    });
                    currentTime = addMinutes(currentTime, visitMins);
                    const currentMins = timeToMins(currentTime);

                    // Dynamic API Search Lunch if NOT provided by user
                    if (!hasLunch && currentMins >= 12 * 60 && currentMins <= 15 * 60) {
                        hasLunch = true;
                        let restaurant = null;
                        try {
                            restaurant = await new Promise((resolve) => {
                                ps.nearbySearch({
                                    location: { lat: place.lat, lng: place.lng }, radius: 1000, type: 'restaurant',
                                    rankBy: window.google.maps.places.RankBy.PROMINENCE,
                                }, (results, status) => {
                                    if (status === window.google.maps.places.PlacesServiceStatus.OK && results?.length) {
                                        resolve([...results].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0]);
                                    } else resolve(null);
                                });
                            });
                        } catch (_) { }

                        timeline.push({
                            type: 'meal', mealTime: 'Almuerzo', time: currentTime,
                            name: restaurant ? `🍴 ${restaurant.name}` : '🍴 Busca un restaurante cercano',
                            rating: restaurant?.rating || null, vicinity: restaurant?.vicinity || '',
                            lat: restaurant?.geometry?.location.lat() || place.lat, lng: restaurant?.geometry?.location.lng() || place.lng,
                            icon: '🍴',
                        });
                        currentTime = addMinutes(currentTime, 75);
                    }

                    // Dynamic API Search Dinner if NOT provided by user
                    if (!hasDinner && currentMins >= 19 * 60 + 30 && currentMins <= 22 * 60 + 30) {
                        hasDinner = true;
                        let restaurant = null;
                        try {
                            restaurant = await new Promise((resolve) => {
                                ps.nearbySearch({
                                    location: { lat: place.lat, lng: place.lng }, radius: 1500, type: 'restaurant',
                                    rankBy: window.google.maps.places.RankBy.PROMINENCE,
                                }, (results, status) => {
                                    if (status === window.google.maps.places.PlacesServiceStatus.OK && results?.length) {
                                        resolve([...results].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0]);
                                    } else resolve(null);
                                });
                            });
                        } catch (_) { }

                        timeline.push({
                            type: 'meal', mealTime: 'Cena', time: currentTime,
                            name: restaurant ? `🍴 ${restaurant.name}` : '🍴 Busca un restaurante cercano',
                            rating: restaurant?.rating || null, vicinity: restaurant?.vicinity || '',
                            lat: restaurant?.geometry?.location.lat() || place.lat, lng: restaurant?.geometry?.location.lng() || place.lng,
                            icon: '🍴',
                        });
                        currentTime = addMinutes(currentTime, 90);
                    }
                    if (legs[i + 1]) currentTime = addMinutes(currentTime, legs[i + 1].durationMins);
                }
            }

            if (legs[sequence.length]) {
                currentTime = addMinutes(currentTime, legs[sequence.length].durationMins);
            }

            timeline.push({
                type: 'arrival',
                time: currentTime,
                name: endLoc?.name || 'Destino final',
                icon: '🏁',
            });

            const newItinerary = {
                id: editingDay,
                title,
                startTime,
                startId,
                endId,
                startLoc,
                endLoc,
                optimizedPois,
                legs,
                timeline,
                totalDurationSec: legs.reduce((a, b) => a + b.durationSec, 0)
            };

            const existingIndex = itineraries.findIndex(i => i.id === editingDay);
            const updatedList = [...itineraries];
            if (existingIndex >= 0) updatedList[existingIndex] = newItinerary;
            else updatedList.push(newItinerary);

            store.updateTrip(trip.id, { itineraries: updatedList });
            setEditingDay(null);
        } catch (err) {
            alert(`No se pudo calcular la ruta. Error: ${err.message}. Comprueba que 'Directions API' y 'Places API' están habilitadas en Google Cloud.`);
        } finally {
            setGenerating(false);
        }
    };

    // ===== RENDER: EDIT FORM =====
    if (editingDay) {
        return (
            <div className="animate-fade-in-up">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                    <h2 className="text-subtitle">Planificar Ruta</h2>
                    <button className="text-caption text-secondary" onClick={() => setEditingDay(null)}>Cancelar</button>
                </div>

                {/* Name + Start time */}
                <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                        <div style={{ flex: 2 }}>
                            <label className="field-label" style={{ marginBottom: '4px' }}>Nombre del día</label>
                            <input className="input-field" style={{ padding: '12px 16px' }} value={title} onChange={e => setTitle(e.target.value)} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label className="field-label" style={{ marginBottom: '4px' }}>Hora inicio</label>
                            <input className="input-field" type="time" style={{ padding: '12px 16px' }} value={startTime} onChange={e => setStartTime(e.target.value)} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
                        <div style={{ flex: 1 }}>
                            <label className="field-label" style={{ marginBottom: '4px' }}>Punto de Partida</label>
                            <select className="input-field" style={{ padding: '12px 16px' }} value={startId} onChange={e => setStartId(e.target.value)}>
                                <option value="">Seleccionar...</option>
                                {allLocations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label className="field-label" style={{ marginBottom: '4px' }}>Punto Final</label>
                            <select className="input-field" style={{ padding: '12px 16px' }} value={endId} onChange={e => setEndId(e.target.value)}>
                                <option value="">Seleccionar...</option>
                                {allLocations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                {/* POI selection with visit hours */}
                <h3 className="text-body" style={{ fontWeight: 700, marginBottom: '4px' }}>¿Qué vas a visitar?</h3>
                <p className="text-caption text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
                    Selecciona los lugares e indica cuánto tiempo estimas. El itinerario incluirá almuerzo y cena automáticamente.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--space-xl)' }}>
                    {trip.pois.filter(p => p.isActive !== false).map(poi => {
                        const isSelected = selectedPois.includes(poi.id);
                        const defaultHrs = VISIT_DURATION[poi.category] || 1.5;
                        return (
                            <div key={poi.id}
                                className="card"
                                style={{ padding: '12px', border: `1px solid ${isSelected ? 'var(--color-primary)' : 'transparent'}` }}
                            >
                                <button
                                    type="button"
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', background: 'transparent', border: 'none', WebkitTapHighlightColor: 'transparent', padding: '8px 0', width: '100%', textAlign: 'left' }}
                                    onClick={() => togglePoiSelection(poi.id)}
                                >
                                    <div style={{
                                        width: '20px', height: '20px', borderRadius: '4px', flexShrink: 0,
                                        border: isSelected ? 'none' : '1px solid var(--text-tertiary)',
                                        background: isSelected ? 'var(--color-primary)' : 'transparent',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}>
                                        {isSelected && <CheckCircle2 size={14} color="white" />}
                                    </div>
                                    <span style={{ flex: 1, fontWeight: isSelected ? 700 : 500, fontSize: '14px' }}>
                                        {categoryEmoji(poi.category)} {poi.name}
                                    </span>
                                </button>
                                {isSelected && (
                                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '8px', paddingLeft: '30px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
                                            <span className="text-caption text-secondary">Estima:</span>
                                            <input
                                                type="number"
                                                min="0.5"
                                                max="12"
                                                step="0.5"
                                                value={visitHours[poi.id] ?? defaultHrs}
                                                onClick={e => e.stopPropagation()}
                                                onChange={e => setVisitHours(prev => ({ ...prev, [poi.id]: parseFloat(e.target.value) }))}
                                                style={{ width: '56px', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-tertiary)' }}
                                            />
                                            <span className="text-caption text-secondary">h</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Navigation size={14} style={{ color: 'var(--text-tertiary)' }} />
                                            <select
                                                value={travelModes[poi.id] || 'DRIVING'}
                                                onChange={e => setTravelModes(prev => ({ ...prev, [poi.id]: e.target.value }))}
                                                onClick={e => e.stopPropagation()}
                                                style={{ padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px', background: 'var(--bg-tertiary)', cursor: 'pointer' }}
                                            >
                                                <option value="DRIVING">🚗 Coche</option>
                                                <option value="WALKING">🚶 A pie</option>
                                                <option value="TRANSIT">🚌 TP</option>
                                                <option value="BICYCLING">🚲 Bici</option>
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <button
                    className="btn btn-accent btn-full"
                    onClick={generateRoute}
                    disabled={generating || !startId || !endId || selectedPois.length === 0}
                >
                    {generating ? '⏳ Calculando itinerario...' : '🗺️ Generar Itinerario Optimizado'}
                </button>
            </div>
        );
    }

    // ===== RENDER: INLINE EDIT MODE =====
    if (editingItinerary && editTimeline) {
        const itinerary = itineraries.find(i => i.id === editingItinerary);
        return (
            <div className="animate-fade-in-up">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                    <h2 className="text-subtitle">✏️ Editar: {itinerary?.title}</h2>
                    <button className="text-caption text-secondary" onClick={() => { setEditingItinerary(null); setEditTimeline(null); }}>
                        Cancelar
                    </button>
                </div>
                <p className="text-caption text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
                    Reordena los pasos, cambia los horarios o elimina paradas.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 'var(--space-lg)' }}>
                    {editTimeline.map((step, idx) => {
                        const isPoi = step.type === 'poi';
                        const isMeal = step.type === 'meal';
                        return (
                            <div key={idx} className="card" style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
                                <span style={{ fontSize: '16px', flexShrink: 0 }}>{step.icon || '📍'}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="text-body" style={{ fontWeight: 600, fontSize: '13px' }}>{step.name}</div>
                                    <input
                                        type="time"
                                        value={step.time}
                                        onChange={e => updateStepTime(idx, e.target.value)}
                                        style={{
                                            fontSize: '12px', color: 'var(--color-primary)', fontWeight: 700,
                                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                    {(isPoi || isMeal) && (
                                        <>
                                            <button
                                                onClick={() => moveStep(idx, -1)}
                                                disabled={idx === 0}
                                                style={{ padding: 6, borderRadius: 6, border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', opacity: idx === 0 ? 0.3 : 1 }}
                                            ><ChevronUp size={14} /></button>
                                            <button
                                                onClick={() => moveStep(idx, 1)}
                                                disabled={idx === editTimeline.length - 1}
                                                style={{ padding: 6, borderRadius: 6, border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', opacity: idx === editTimeline.length - 1 ? 0.3 : 1 }}
                                            ><ChevronDown size={14} /></button>
                                        </>
                                    )}
                                    {(isPoi || isMeal) && (
                                        <button
                                            onClick={() => deleteStep(idx)}
                                            style={{ padding: 6, borderRadius: 6, background: '#fee2e2', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                                        ><X size={14} /></button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <button className="btn btn-primary btn-full" onClick={() => saveEditedItinerary(editingItinerary)}>
                    💾 Guardar Cambios
                </button>
            </div>
        );
    }

    // ===== RENDER: LIST =====
    return (
        <div className="animate-fade-in-up">
            <div style={{ marginBottom: 'var(--space-md)' }}>
                <h2 className="text-subtitle" style={{ marginBottom: '4px' }}>Itinerarios Diarios</h2>
                <p className="text-body text-secondary">
                    Genera rutas optimizadas con horarios y paradas de comida.
                </p>
            </div>

            <div>
                {itineraries.map((itinerary) => {
                    const mapsUrl = buildMapsUrl(itinerary.startLoc, itinerary.optimizedPois, itinerary.endLoc);
                    return (
                        <div key={itinerary.id} className="card" style={{ marginBottom: 'var(--space-md)' }}>
                            {/* Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '16px' }}>
                                <div>
                                    <h3 style={{ fontWeight: 700, fontSize: '17px' }}>{itinerary.title}</h3>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', color: 'var(--color-primary)' }}>
                                        <Clock size={13} />
                                        <span className="text-caption" style={{ fontWeight: 700 }}>
                                            Conducción total: {formatDuration(itinerary.totalDurationSec)}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {/* Edit button */}
                                    <button
                                        style={{ padding: '8px', borderRadius: '8px', color: 'var(--color-primary)', border: '1px solid var(--border-color)' }}
                                        onClick={() => handleEditExisting(itinerary)}
                                        title="Editar itinerario"
                                    >
                                        <Edit3 size={15} />
                                    </button>
                                    {/* Delete button */}
                                    <button style={{ padding: '8px', borderRadius: '8px', color: 'var(--color-danger)' }}
                                        onClick={() => deleteItinerary(itinerary.id)}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Open in Google Maps button */}
                            {mapsUrl && (
                                <a
                                    href={mapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-outline"
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16, textDecoration: 'none', fontSize: '13px' }}
                                >
                                    <Map size={15} /> Ver recorrido en Google Maps
                                    <ExternalLink size={13} />
                                </a>
                            )}

                            {/* Timeline */}
                            {(itinerary.timeline || []).map((step, i) => {
                                const isLast = i === itinerary.timeline.length - 1;
                                const dotColor = step.type === 'meal' ? '#f97316' : step.type === 'poi' ? 'var(--color-primary)' : '#6b7280';
                                const poiData = step.poiId ? trip.pois.find(p => p.id === step.poiId) : null;
                                return (
                                    <div key={i} style={{ display: 'flex', gap: '12px' }}>
                                        {/* Dot + line */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                            <div style={{
                                                width: step.type === 'poi' ? '26px' : '18px',
                                                height: step.type === 'poi' ? '26px' : '18px',
                                                borderRadius: '50%',
                                                background: dotColor,
                                                color: 'white',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '11px', fontWeight: 'bold',
                                                flexShrink: 0,
                                            }}>
                                                {step.type === 'poi' ? (itinerary.timeline.slice(0, i).filter(s => s.type === 'poi').length + 1) : ''}
                                                {step.type === 'meal' && <Utensils size={10} />}
                                                {(step.type === 'departure' || step.type === 'arrival') && <Navigation size={9} />}
                                            </div>
                                            {!isLast && <div style={{ width: '2px', flex: 1, background: 'var(--border-color)', margin: '4px 0', minHeight: '20px' }} />}
                                        </div>

                                        {/* Content */}
                                        <div style={{ flex: 1, paddingBottom: isLast ? 0 : '14px' }}>
                                            <div
                                                style={{ display: 'flex', gap: '8px', alignItems: 'baseline', cursor: poiData ? 'pointer' : 'default' }}
                                                onClick={() => poiData && setPoiDetail(poiData)}
                                            >
                                                <span style={{ fontSize: '12px', fontWeight: 800, color: dotColor, fontVariantNumeric: 'tabular-nums', minWidth: '42px' }}>
                                                    {step.time}
                                                </span>
                                                <span style={{ fontWeight: 700, fontSize: '14px', color: poiData ? 'var(--color-primary)' : 'inherit', textDecoration: poiData ? 'underline dotted' : 'none' }}>
                                                    {step.name}
                                                </span>
                                            </div>
                                            {step.visitDurationText && (
                                                <span className="text-caption text-secondary" style={{ marginLeft: '50px', display: 'block' }}>
                                                    🕒 {step.visitDurationText}
                                                    {step.leg && ` · ${step.leg.icon || '🚗'} ${step.leg.durationText} (${step.leg.distanceText})`}
                                                </span>
                                            )}
                                            {step.type === 'meal' && (
                                                <span className="text-caption" style={{ marginLeft: '50px', display: 'block', fontWeight: 600, color: '#f97316' }}>
                                                    {step.mealTime}
                                                    {step.rating && ` · ⭐ ${step.rating}`}
                                                    {step.vicinity && ` · ${step.vicinity}`}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                {itineraries.length === 0 && (
                    <div className="empty-state" style={{ marginTop: 'var(--space-xl)' }}>
                        <Navigation size={48} />
                        <p className="text-body text-tertiary">Aún no has creado rutas diarias.</p>
                    </div>
                )}
            </div>

            <button className="btn btn-outline btn-full" onClick={handleCreateNew} style={{ marginTop: 'var(--space-lg)' }}>
                <Plus size={16} /> Crear Ruta Diaria
            </button>

            {/* POI Detail Modal */}
            {poiDetail && (
                <PoiDetailModal
                    poi={poiDetail}
                    trip={trip}
                    onClose={() => setPoiDetail(null)}
                    onDelete={() => setPoiDetail(null)}
                />
            )}
        </div>
    );
}
