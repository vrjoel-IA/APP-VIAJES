import { useState } from 'react';
import {
    Plus, Trash2, Navigation, Clock, CheckCircle2, Utensils,
    Map, ExternalLink, ChevronUp, ChevronDown, Edit3, X, Sparkles, Star, PartyPopper
} from 'lucide-react';
import { useApiIsLoaded } from '@vis.gl/react-google-maps';
import { formatDuration } from '../utils/constants';
import { searchNearbyRestaurant } from '../lib/places';
import { generateAiItinerary, resolveSuggestions } from '../lib/ai';
import { toast } from '../lib/toast';
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

export default function ItineraryTab({ trip, store, onShowOnMap }) {
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

    // AI state
    const [aiLoading, setAiLoading] = useState(false);
    const [aiInstructions, setAiInstructions] = useState(''); // indicaciones libres del usuario para la IA
    const [aiSuggestions, setAiSuggestions] = useState([]); // lugares nuevos sugeridos por la IA (resueltos con Google)
    const [aiEvents, setAiEvents] = useState([]); // fiestas/eventos locales detectados para las fechas del viaje

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

    // `opts` permite generar con una selección explícita (la IA la pasa directamente
    // sin esperar a que el estado de React se actualice). Por defecto usa el formulario.
    const generateRoute = async (opts = null) => {
        const poiIds = opts?.poiIds ?? selectedPois;
        const vh = opts?.visitHoursMap ?? visitHours;
        const mt = opts?.mealTypesMap ?? mealTypes;
        const dayTitle = opts?.title ?? title;

        if (!startId || !endId || poiIds.length === 0) {
            return toast('Selecciona punto de salida, llegada y al menos 1 lugar.', 'info');
        }
        if (!apiIsLoaded) return toast('Google Maps aún no ha cargado. Espera un momento.', 'info');

        setGenerating(true);

        const startLoc = allLocations.find(l => l.id === startId);
        const endLoc = allLocations.find(l => l.id === endId);
        const wps = poiIds.map(id => trip.pois.find(p => p.id === id)).filter(Boolean);

        const ds = new window.google.maps.DirectionsService();

        const foodWps = wps.filter(w => w.category === 'food');
        const routeWps = wps.filter(w => w.category !== 'food');

        const lunchPoi = foodWps.find(w => mt[w.id] === 'Almuerzo') || foodWps[0];
        const dinnerPoi = foodWps.find(w => mt[w.id] === 'Cena' || (w !== lunchPoi)) || (lunchPoi ? foodWps[1] : foodWps[0]);

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
                currentMins += ((vh[poi.id] || VISIT_DURATION[poi.category] || 1.5) * 60) + 15;
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
                } catch {
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
                    const visitMins = (vh[place.id] || VISIT_DURATION[place.category] || 1.5) * 60;
                    timeline.push({
                        type: 'poi',
                        time: currentTime,
                        name: place.name,
                        category: place.category,
                        visitHours: vh[place.id] || VISIT_DURATION[place.category] || 1.5,
                        icon: categoryEmoji(place.category),
                        lat: place.lat,
                        lng: place.lng,
                        poiId: place.id,
                        rating: place.rating,
                        visitDurationText: vh[place.id] ? `${vh[place.id]}h visita` : `~${VISIT_DURATION[place.category] || 1.5}h estimada`,
                        leg: legs[i + 1],
                    });
                    currentTime = addMinutes(currentTime, visitMins);
                    const currentMins = timeToMins(currentTime);

                    // Dynamic API Search Lunch if NOT provided by user
                    if (!hasLunch && currentMins >= 12 * 60 && currentMins <= 15 * 60) {
                        hasLunch = true;
                        let restaurant = null;
                        try {
                            restaurant = await searchNearbyRestaurant({ lat: place.lat, lng: place.lng }, 1000);
                        } catch { /* sin restaurante: se usa el lugar como fallback */ }

                        timeline.push({
                            type: 'meal', mealTime: 'Almuerzo', time: currentTime,
                            name: restaurant ? `🍴 ${restaurant.name}` : '🍴 Busca un restaurante cercano',
                            rating: restaurant?.rating || null, vicinity: restaurant?.vicinity || '',
                            lat: restaurant?.lat || place.lat, lng: restaurant?.lng || place.lng,
                            icon: '🍴',
                        });
                        currentTime = addMinutes(currentTime, 75);
                    }

                    // Dynamic API Search Dinner if NOT provided by user
                    if (!hasDinner && currentMins >= 19 * 60 + 30 && currentMins <= 22 * 60 + 30) {
                        hasDinner = true;
                        let restaurant = null;
                        try {
                            restaurant = await searchNearbyRestaurant({ lat: place.lat, lng: place.lng }, 1500);
                        } catch { /* sin restaurante: se usa el lugar como fallback */ }

                        timeline.push({
                            type: 'meal', mealTime: 'Cena', time: currentTime,
                            name: restaurant ? `🍴 ${restaurant.name}` : '🍴 Busca un restaurante cercano',
                            rating: restaurant?.rating || null, vicinity: restaurant?.vicinity || '',
                            lat: restaurant?.lat || place.lat, lng: restaurant?.lng || place.lng,
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
                title: dayTitle,
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
            toast(`No se pudo calcular la ruta (${err.message}). Comprueba que Directions API y Places API estén habilitadas en Google Cloud.`, 'error', 6000);
        } finally {
            setGenerating(false);
        }
    };

    // POIs ya usados en itinerarios existentes (no se reutilizan al generar con IA).
    const getAssignedPoiIds = () => {
        const ids = new Set();
        itineraries.forEach(it => (it.timeline || []).forEach(step => {
            if (step.type === 'poi' && step.poiId) ids.add(step.poiId);
        }));
        return ids;
    };

    // Construye el itinerario completo a partir del plan razonado de la IA:
    // geolocaliza paradas, resuelve restaurantes y calcula trayectos con Google.
    const buildAiItinerary = async (ai, startLoc, endLoc, candidates) => {
        // OJO: en este archivo `Map` es el icono de lucide-react, no el Map de JS.
        // Por eso usamos un objeto plano como índice de candidatos por id.
        const candById = {};
        candidates.forEach(c => { candById[c.id] = c; });
        const ds = new window.google.maps.DirectionsService();
        const timeline = [];
        const optimizedPois = [];
        const geoPoints = [{ lat: startLoc.lat, lng: startLoc.lng }];
        const geoStepIdx = [];

        timeline.push({ type: 'departure', time: startTime, name: startLoc.name || 'Punto de partida', icon: '🚗' });
        const departureIdx = timeline.length - 1;

        for (const item of (ai.timeline || [])) {
            if (item.type === 'poi') {
                const poi = candById[item.poiId];
                if (!poi) continue;
                const hrs = item.durationMins ? item.durationMins / 60 : (VISIT_DURATION[poi.category] || 1.5);
                timeline.push({
                    type: 'poi', time: item.startTime, name: poi.name, category: poi.category,
                    visitHours: hrs, visitDurationText: `${Math.round(hrs * 10) / 10}h visita`,
                    icon: categoryEmoji(poi.category), lat: poi.lat, lng: poi.lng, poiId: poi.id,
                    rating: poi.rating, note: item.note || '',
                });
                optimizedPois.push({ lat: poi.lat, lng: poi.lng, name: poi.name });
                geoPoints.push({ lat: poi.lat, lng: poi.lng });
                geoStepIdx.push(timeline.length - 1);
            } else if (item.type === 'meal') {
                const near = geoPoints[geoPoints.length - 1];
                let restaurant = null;
                try { restaurant = await searchNearbyRestaurant(near, 1500); } catch { /* sin restaurante */ }
                const lat = restaurant?.lat || near.lat;
                const lng = restaurant?.lng || near.lng;
                timeline.push({
                    type: 'meal', mealTime: item.mealType || 'Comida', time: item.startTime,
                    name: restaurant ? `🍴 ${restaurant.name}` : `🍴 ${item.name}`,
                    rating: restaurant?.rating || null, vicinity: restaurant?.vicinity || '',
                    lat, lng, icon: '🍴', note: item.note || '',
                });
                geoPoints.push({ lat, lng });
                geoStepIdx.push(timeline.length - 1);
            } else {
                timeline.push({
                    type: 'free', time: item.startTime, name: item.name, icon: '✨', note: item.note || '',
                    visitDurationText: item.durationMins ? `${Math.round(item.durationMins / 60 * 10) / 10}h` : '',
                });
            }
        }

        const last = ai.timeline?.[ai.timeline.length - 1];
        const arrivalTime = last ? addMinutes(last.startTime, last.durationMins || 0) : startTime;
        timeline.push({ type: 'arrival', time: arrivalTime, name: endLoc.name || 'Destino final', icon: '🏁' });
        geoPoints.push({ lat: endLoc.lat, lng: endLoc.lng });

        // Trayectos reales entre puntos geolocalizados consecutivos.
        const legs = [];
        for (let i = 0; i < geoPoints.length - 1; i++) {
            let leg = null;
            try {
                leg = await new Promise(resolve => {
                    ds.route({ origin: geoPoints[i], destination: geoPoints[i + 1], travelMode: 'DRIVING' },
                        (res, st) => resolve(st === 'OK' ? res.routes[0].legs[0] : null));
                });
            } catch { /* sin trayecto */ }
            legs.push(leg
                ? { durationText: leg.duration.text, distanceText: leg.distance.text, durationSec: leg.duration.value, durationMins: leg.duration.value / 60, mode: 'DRIVING', icon: '🚗' }
                : { durationText: '—', distanceText: '—', durationSec: 0, durationMins: 0, mode: 'DRIVING', icon: '🚗' });
            await new Promise(r => setTimeout(r, 150));
        }
        if (legs[0]) timeline[departureIdx].leg = legs[0];
        geoStepIdx.forEach((idx, k) => { if (legs[k + 1]) timeline[idx].leg = legs[k + 1]; });

        const totalDurationSec = legs.reduce((a, b) => a + (b.durationSec || 0), 0);
        return { timeline, optimizedPois, legs, totalDurationSec };
    };

    const handleGenerateAI = async () => {
        if (!startId || !endId) return toast('Elige el punto de inicio y fin del día.', 'info');
        if (!apiIsLoaded) return toast('Google Maps aún cargando. Espera un momento.', 'info');

        const assigned = getAssignedPoiIds();
        const candidates = trip.pois.filter(p => p.isActive !== false && !assigned.has(p.id));
        if (candidates.length === 0) {
            return toast('No quedan lugares sin asignar. Añade más o edita un día existente.', 'info');
        }

        const startLoc = allLocations.find(l => l.id === startId);
        const endLoc = allLocations.find(l => l.id === endId);

        // Fecha concreta de este día = inicio del viaje + (díaN - 1), para que la IA
        // tenga en cuenta fiestas/eventos temporales que coincidan con esas fechas.
        const dayNumber = itineraries.length + 1;
        let dayDate = null;
        if (trip.startDate) {
            const d = new Date(trip.startDate);
            if (!isNaN(d)) {
                d.setDate(d.getDate() + (dayNumber - 1));
                dayDate = d.toISOString().slice(0, 10);
            }
        }

        setAiLoading(true);
        try {
            const ai = await generateAiItinerary({
                destination: trip.destination || '',
                dayNumber,
                dayDate,
                tripStart: trip.startDate || null,
                tripEnd: trip.endDate || null,
                instructions: aiInstructions.trim(),
                startTime,
                start: { name: startLoc.name, lat: startLoc.lat, lng: startLoc.lng },
                end: { name: endLoc.name, lat: endLoc.lat, lng: endLoc.lng },
                candidates: candidates.map(c => ({
                    id: c.id, name: c.name, category: c.category,
                    rating: c.rating, reviews: c.userRatingsTotal, lat: c.lat, lng: c.lng,
                })),
            });

            setAiEvents(Array.isArray(ai.events) ? ai.events : []);

            const built = await buildAiItinerary(ai, startLoc, endLoc, candidates);
            if (built.optimizedPois.length === 0) {
                toast('La IA no encontró una combinación válida. Prueba a añadir más lugares.', 'info');
                return;
            }

            const newItinerary = {
                id: editingDay,
                title: ai.dayTitle || `Día ${dayNumber}`,
                summary: ai.summary || '',
                startTime, startId, endId, startLoc, endLoc,
                optimizedPois: built.optimizedPois,
                legs: built.legs,
                timeline: built.timeline,
                totalDurationSec: built.totalDurationSec,
            };
            const existingIndex = itineraries.findIndex(i => i.id === editingDay);
            const updatedList = [...itineraries];
            if (existingIndex >= 0) updatedList[existingIndex] = newItinerary;
            else updatedList.push(newItinerary);
            store.updateTrip(trip.id, { itineraries: updatedList });
            setEditingDay(null);

            // Resuelve las sugerencias de lugares NUEVOS con Google Places.
            const locationBias = trip.destinationLat && trip.destinationLng
                ? { lat: trip.destinationLat, lng: trip.destinationLng }
                : null;
            const resolved = await resolveSuggestions(ai.suggestions || [], {
                destination: trip.destination, locationBias,
            });
            const existingPlaceIds = new Set(trip.pois.map(p => p.placeId).filter(Boolean));
            setAiSuggestions(resolved.filter(r => !r.placeId || !existingPlaceIds.has(r.placeId)));
        } catch (err) {
            toast(`No se pudo generar con IA: ${err.message}`, 'error', 7000);
        } finally {
            setAiLoading(false);
        }
    };

    const addSuggestionToTrip = (place) => {
        store.addPoi(trip.id, {
            name: place.name, placeId: place.placeId, category: 'other',
            lat: place.lat, lng: place.lng, address: place.address || '',
            rating: place.rating || null, userRatingsTotal: place.userRatingsTotal || null,
            photoUrl: place.photoUrl || null, photos: place.photos || [],
            openingHours: place.openingHours || null, website: place.website || null,
            phoneNumber: place.phoneNumber || null, priceLevel: place.priceLevel ?? null,
            types: place.types || [],
        });
        toast(`"${place.name}" añadido al viaje.`, 'success');
        setAiSuggestions(prev => prev.filter(s => s.placeId !== place.placeId));
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

                {/* Generación con IA */}
                <div className="card" style={{ marginBottom: 'var(--space-md)', border: '1px solid var(--color-primary)', background: 'var(--color-primary-light)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <Sparkles size={18} style={{ color: 'var(--color-primary)' }} />
                        <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--color-primary)' }}>Generar con IA</span>
                    </div>
                    <p className="text-caption text-secondary" style={{ marginBottom: '10px' }}>
                        Elige solo el inicio, el fin y la hora. La IA seleccionará los mejores lugares de tu lista,
                        los ordenará por cercanía y te sugerirá sitios imprescindibles. Podrás editarlo después.
                    </p>
                    <textarea
                        className="input-field"
                        rows={2}
                        style={{ padding: '10px 12px', resize: 'vertical', marginBottom: '10px', fontSize: '13px' }}
                        placeholder="Ideas o indicaciones (opcional): vamos con niños, prioriza playa, ritmo relajado, evita museos..."
                        value={aiInstructions}
                        onChange={e => setAiInstructions(e.target.value)}
                    />
                    <button
                        className="btn btn-primary btn-full"
                        onClick={handleGenerateAI}
                        disabled={aiLoading || generating || !startId || !endId}
                    >
                        {aiLoading ? '🧠 Pensando tu día...' : '✨ Generar día con IA'}
                    </button>
                </div>

                {/* POI selection with visit hours */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '4px' }}>
                    <h3 className="text-body" style={{ fontWeight: 700 }}>O elígelos tú</h3>
                    {(() => {
                        const activePois = trip.pois.filter(p => p.isActive !== false);
                        const allSelected = activePois.length > 0 && activePois.every(p => selectedPois.includes(p.id));
                        return (
                            <button
                                className="text-caption"
                                style={{ color: 'var(--color-primary)', fontWeight: 700 }}
                                onClick={() => setSelectedPois(allSelected ? [] : activePois.map(p => p.id))}
                            >
                                {allSelected ? 'Desmarcar todos' : 'Marcar todos'}
                            </button>
                        );
                    })()}
                </div>
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
                    onClick={() => generateRoute()}
                    disabled={generating || aiLoading || !startId || !endId || selectedPois.length === 0}
                >
                    {generating ? '⏳ Calculando itinerario...' : '🗺️ Generar con mi selección'}
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

            {/* Eventos y fiestas locales detectados por la IA para las fechas del viaje */}
            {aiEvents.length > 0 && (
                <div className="card animate-fade-in-up" style={{ marginBottom: 'var(--space-md)', border: '1px solid var(--color-gold)', background: 'var(--color-gold-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <PartyPopper size={18} style={{ color: 'var(--color-gold)' }} />
                            <span style={{ fontWeight: 800, fontSize: '14px' }}>Fiestas y eventos en tus fechas</span>
                        </div>
                        <button onClick={() => setAiEvents([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={16} /></button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
                        {aiEvents.map((ev, i) => (
                            <div key={i} style={{ borderLeft: '3px solid var(--color-gold)', paddingLeft: '10px' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700, fontSize: '13px' }}>{ev.name}</span>
                                    {ev.date && <span className="text-caption" style={{ color: 'var(--color-gold)', fontWeight: 700 }}>{ev.date}</span>}
                                </div>
                                <p className="text-caption text-secondary" style={{ lineHeight: 1.5 }}>{ev.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Sugerencias de la IA (lugares nuevos resueltos con Google Places) */}
            {aiSuggestions.length > 0 && (
                <div className="card animate-fade-in-up" style={{ marginBottom: 'var(--space-md)', border: '1px solid var(--color-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Sparkles size={18} style={{ color: 'var(--color-primary)' }} />
                            <span style={{ fontWeight: 800, fontSize: '14px' }}>La IA también te recomienda</span>
                        </div>
                        <button onClick={() => setAiSuggestions([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={16} /></button>
                    </div>
                    <p className="text-caption text-secondary" style={{ marginBottom: '12px' }}>
                        Lugares que no tenías. Añádelos al viaje para incluirlos en un día.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {aiSuggestions.map(s => (
                            <div key={s.placeId} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ fontWeight: 700, fontSize: '13px' }} className="truncate">{s.name}</span>
                                        {s.essential && (
                                            <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--color-primary)', background: 'var(--color-primary-light)', padding: '2px 6px', borderRadius: 'var(--radius-full)', flexShrink: 0 }}>IMPRESCINDIBLE</span>
                                        )}
                                        {s.rating && (
                                            <span className="text-caption" style={{ color: '#f5a623', display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}><Star size={11} fill="#f5a623" /> {s.rating}</span>
                                        )}
                                    </div>
                                    <p className="text-caption text-secondary truncate">{s.aiReason}</p>
                                </div>
                                <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '12px', width: 'auto', flexShrink: 0 }} onClick={() => addSuggestionToTrip(s)}>
                                    <Plus size={14} /> Añadir
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
                                    {/* Ver en el mapa de la app */}
                                    {onShowOnMap && (
                                        <button
                                            style={{ padding: '8px', borderRadius: '8px', color: 'var(--color-primary)', border: '1px solid var(--border-color)' }}
                                            onClick={() => onShowOnMap(itinerary)}
                                            title="Ver la ruta en el mapa"
                                        >
                                            <Map size={15} />
                                        </button>
                                    )}
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

                            {/* Resumen razonado del día (estilo guía) */}
                            {itinerary.summary && (
                                <p className="text-caption text-secondary" style={{ marginBottom: 14, lineHeight: 1.55, fontStyle: 'italic' }}>
                                    {itinerary.summary}
                                </p>
                            )}

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
                                const dotColor = step.type === 'meal' ? '#f97316' : step.type === 'poi' ? 'var(--color-primary)' : step.type === 'free' ? 'var(--color-gold)' : '#6b7280';
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
                                                {step.type === 'free' && <Sparkles size={10} />}
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
                                            {step.note && (
                                                <span className="text-caption text-secondary" style={{ marginLeft: '50px', display: 'block', lineHeight: 1.45, marginTop: '3px' }}>
                                                    {step.note}
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
