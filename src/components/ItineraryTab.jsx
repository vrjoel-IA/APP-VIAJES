import { useState, useMemo } from 'react';
import {
    Plus, Trash2, Navigation, Clock, Utensils,
    Map, ExternalLink, Edit3, X, Sparkles, PartyPopper, GripVertical,
    Search, Calendar, Lightbulb, AlertTriangle
} from 'lucide-react';
import { useApiIsLoaded, Map as GMap, AdvancedMarker, InfoWindow } from '@vis.gl/react-google-maps';
import {
    DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors
} from '@dnd-kit/core';
import {
    SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDuration, CATEGORY_MAP, getPlaceholderImage } from '../utils/constants';
import { haversineMeters } from '../lib/tripSchema';
import { searchNearbyRestaurant, searchPlacesByText } from '../lib/places';
import { parseNotes } from '../lib/notesFormat';
import { generateAiItinerary, resolveSuggestions } from '../lib/ai';
import { toast } from '../lib/toast';
import PoiDetailModal from './PoiDetailModal';

// Colores del estado de un lugar en el mini-mapa y la lista.
const PIN_UNSET = '#94a3b8';   // gris: sin elegir
const PIN_FIXED = '#4a63e7';   // azul: fijado a este día
const PIN_OTHER = '#10b981';   // verde: asignado a otro día

// Duración de visita por categoría (estimación por defecto, en horas).
const VISIT_DURATION = {
    beach: 2.5, culture: 1.5, monument: 1.5, museo: 1.5, pueblo: 2, ciudad: 3,
    nature: 3.5, mirador: 0.75, ruta: 3, food: 1, other: 1.5,
};

function addMinutes(timeStr, minutes) {
    const [h, m] = (timeStr || '09:00').split(':').map(Number);
    const totalMins = h * 60 + m + Math.round(minutes);
    const newH = Math.floor(totalMins / 60) % 24;
    const newM = totalMins % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function categoryEmoji(cat) {
    return CATEGORY_MAP[cat]?.emoji || '📍';
}

// Zona de un lugar: la comarca de sus notas (Datos prácticos) o, si no, el municipio.
function getZona(poi) {
    const blocks = parseNotes(poi.notas);
    const datos = blocks.find(b => b.pairs);
    const comarca = datos?.pairs.find(p => /comarca/i.test(p.k))?.v;
    return (comarca || poi.municipio || 'Otra zona').trim();
}

// Deep-link a Google Maps con la ruta completa (para abrir fuera).
function buildMapsUrl(startLoc, optimizedPois, endLoc) {
    if (!startLoc || !endLoc || !optimizedPois?.length) return null;
    const origin = encodeURIComponent(`${startLoc.lat},${startLoc.lng}`);
    const destination = encodeURIComponent(`${endLoc.lat},${endLoc.lng}`);
    const waypoints = optimizedPois.map(p => encodeURIComponent(`${p.lat},${p.lng}`)).join('|');
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=driving`;
}

// Fecha ISO (yyyy-mm-dd) legible: "18 ago".
function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// Fila reordenable del editor de itinerario (arrastrar y soltar, táctil incluido).
function SortableStep({ step, idx, total, onDelete, onTimeChange }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.dndId });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 2 : 1 };
    return (
        <div ref={setNodeRef} style={style} className="card">
            <div style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="button" className="dnd-handle" {...attributes} {...listeners} aria-label="Arrastrar para reordenar"
                    style={{ cursor: 'grab', touchAction: 'none', color: 'var(--text-tertiary)', background: 'none', border: 'none', display: 'flex', flexShrink: 0, padding: 2 }}>
                    <GripVertical size={16} />
                </button>
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{step.icon || '📍'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="text-body truncate" style={{ fontWeight: 600, fontSize: '13px' }}>{step.name}</div>
                    <input type="time" value={step.time || ''} onChange={e => onTimeChange(idx, e.target.value)}
                        style={{ fontSize: '12px', color: 'var(--color-primary)', fontWeight: 700, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} />
                </div>
                <button onClick={() => onDelete(idx)} aria-label="Eliminar parada" disabled={total <= 1}
                    style={{ padding: 6, borderRadius: 6, background: '#fee2e2', border: 'none', cursor: 'pointer', color: '#ef4444', flexShrink: 0 }}>
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}

// Badge del origen de una parada en el itinerario generado.
function OrigenBadge({ origen, fecha }) {
    if (origen === 'fijado') return <span className="chip" style={{ fontSize: 10, padding: '2px 8px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontWeight: 800 }}>📌 Tuyo</span>;
    if (origen === 'evento_fecha') return <span className="chip" style={{ fontSize: 10, padding: '2px 8px', background: 'var(--color-gold-light)', color: 'var(--color-gold)', fontWeight: 800 }}>🎪 Evento{fecha ? ` · ${fmtDate(fecha)}` : ''}</span>;
    if (origen === 'ia') return <span className="chip" style={{ fontSize: 10, padding: '2px 8px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontWeight: 800 }}>✨ IA</span>;
    return null;
}

export default function ItineraryTab({ trip, store, onShowOnMap }) {
    const apiIsLoaded = useApiIsLoaded();
    const itineraries = trip.itineraries || [];
    const poiById = (id) => trip.pois.find(p => p.id === id);

    // ----- Estado del planificador -----
    const [editingDay, setEditingDay] = useState(null);      // id/flag del día en edición (planner abierto)
    const [editingItinerary, setEditingItinerary] = useState(null); // id de itinerario en edición (DnD)
    const [editTimeline, setEditTimeline] = useState(null);
    const [poiDetail, setPoiDetail] = useState(null);

    const [title, setTitle] = useState('');
    const [dayDate, setDayDate] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [startId, setStartId] = useState('');
    const [endId, setEndId] = useState('');
    const [mode, setMode] = useState('completar');           // 'completar' | 'ordenar'
    const [fixedIds, setFixedIds] = useState([]);            // poiIds fijados a ESTE día
    const [fixedEvents, setFixedEvents] = useState([]);      // nombres de eventos fijados
    const [zoneFilter, setZoneFilter] = useState('all');
    const [catFilter, setCatFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [aiInstructions, setAiInstructions] = useState('');
    const [aiDays, setAiDays] = useState(1);

    const [mapPopupId, setMapPopupId] = useState(null);      // poi mostrado en el popup del mini-mapa
    const [eventsOpen, setEventsOpen] = useState(false);

    const [aiLoading, setAiLoading] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchSug, setSearchSug] = useState([]);          // sugerencias de la IA para la búsqueda
    const [aiSuggestions, setAiSuggestions] = useState([]);  // sugerencias tras generar
    const [aiEvents, setAiEvents] = useState([]);

    // ----- Sensores DnD -----
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const allLocations = [
        ...trip.accommodations.filter(a => a.isActive !== false).map(a => ({ ...a, type: 'accommodation', label: `🏨 ${a.name}` })),
        ...trip.pois.filter(p => p.isActive !== false).map(p => ({ ...p, type: 'poi', label: `📍 ${p.name}` })),
    ];

    // ----- Derivados: zona por lugar, zonas del viaje, asignaciones a días -----
    const activePois = useMemo(() => trip.pois.filter(p => p.isActive !== false && !p.descartado), [trip.pois]);

    const zonaByPoi = useMemo(() => {
        const m = {};
        activePois.forEach(p => { m[p.id] = getZona(p); });
        return m;
    }, [activePois]);

    const zones = useMemo(() => {
        const counts = {};
        activePois.forEach(p => { const z = zonaByPoi[p.id]; counts[z] = (counts[z] || 0) + 1; });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    }, [activePois, zonaByPoi]);

    // poiId -> nº de día al que ya está asignado (según los timelines existentes).
    const assignedByPoi = useMemo(() => {
        const m = {};
        itineraries.forEach((it, idx) => (it.timeline || []).forEach(s => {
            if (s.type === 'poi' && s.poiId) m[s.poiId] = idx + 1;
        }));
        return m;
    }, [itineraries]);

    // Eventos del viaje que coinciden con la fecha elegida.
    const eventsForDate = useMemo(() => {
        if (!dayDate) return [];
        return (trip.eventos || []).filter(e => {
            const ini = e.fechaInicio || e.fechaFin;
            const fin = e.fechaFin || e.fechaInicio;
            if (!ini) return false;
            return dayDate >= ini && dayDate <= fin;
        });
    }, [dayDate, trip.eventos]);

    // ----- Abrir el planificador -----
    const nextDayDate = (dayNumber) => {
        if (!trip.startDate) return '';
        const d = new Date(trip.startDate + 'T00:00:00');
        if (isNaN(d)) return '';
        d.setDate(d.getDate() + (dayNumber - 1));
        return d.toISOString().slice(0, 10);
    };

    const openPlanner = (preset = {}) => {
        const dayNumber = preset.dayNumber ?? itineraries.length + 1;
        setEditingDay(preset.id || Date.now().toString());
        setTitle(preset.title || `Día ${dayNumber}`);
        setDayDate(preset.fecha || nextDayDate(dayNumber));
        setStartTime('09:00');
        const base = preset.baseId || trip.selectedAccommodation || (trip.accommodations.find(a => a.isActive !== false)?.id) || '';
        setStartId(base);
        setEndId(base);
        setMode('completar');
        setFixedIds(preset.fixedIds || []);
        setFixedEvents([]);
        setZoneFilter('all');
        setSearch(''); setSearchSug([]);
        setAiInstructions('');
        setAiDays(1);
        setMapPopupId(null);
        setEditingItinerary(null);
    };

    const handleCreateNew = () => openPlanner();

    // Día-semilla importado: abrir con sus paradas ya fijadas.
    const handlePlanSeedDay = (day) => openPlanner({
        id: day.id, title: day.title || `Día ${day.dia || ''}`.trim(), fecha: day.fecha, baseId: day.baseId,
        fixedIds: (day.paradas || []).filter(id => activePois.some(p => p.id === id)),
    });

    // ----- Fijar / quitar un lugar del día -----
    const toggleFixed = (poiId) => {
        const otherDay = assignedByPoi[poiId];
        const isFixed = fixedIds.includes(poiId);
        if (!isFixed && otherDay && otherDay !== itineraries.findIndex(i => i.id === editingDay) + 1) {
            if (!confirm(`Este lugar ya está en el Día ${otherDay}. ¿Fijarlo también a este día?`)) return;
        }
        setFixedIds(prev => prev.includes(poiId) ? prev.filter(id => id !== poiId) : [...prev, poiId]);
    };

    // ----- Buscador con sugerencias de IA/Places -----
    const runSearch = async () => {
        const q = search.trim();
        if (!q) { setSearchSug([]); return; }
        if (!apiIsLoaded) return;
        setSearchLoading(true);
        try {
            const bias = trip.destinationLat && trip.destinationLng ? { lat: trip.destinationLat, lng: trip.destinationLng } : null;
            const results = await searchPlacesByText(`${q} ${trip.destination || ''}`.trim(), { locationBias: bias, limit: 4 });
            const existing = new Set(trip.pois.map(p => p.placeId).filter(Boolean));
            setSearchSug(results.filter(r => !r.placeId || !existing.has(r.placeId)));
        } catch { setSearchSug([]); }
        finally { setSearchLoading(false); }
    };

    // Añade una sugerencia del buscador al viaje y la deja fijada al día.
    const addSearchSuggestion = (place) => {
        const id = store.addPoi(trip.id, {
            name: place.name, placeId: place.placeId, category: 'other',
            lat: place.lat, lng: place.lng, address: place.address || '',
            rating: place.rating || null, userRatingsTotal: place.userRatingsTotal || null,
            photoUrl: place.photoUrl || null, photos: place.photos || [],
            openingHours: place.openingHours || null, website: place.website || null,
            phoneNumber: place.phoneNumber || null, priceLevel: place.priceLevel ?? null, types: place.types || [],
        });
        if (id) setFixedIds(prev => [...prev, id]);
        setSearchSug(prev => prev.filter(s => s.placeId !== place.placeId));
        setSearch('');
        toast(`"${place.name}" añadido y fijado al día.`, 'success');
    };

    // ----- Generación con IA -----
    const buildFromParadas = async (ai, startLoc, endLoc, candById) => {
        const ds = new window.google.maps.DirectionsService();
        const timeline = [];
        const optimizedPois = [];
        const geoPoints = [{ lat: startLoc.lat, lng: startLoc.lng }];
        const geoStepIdx = [];
        let departureIdx = -1;

        const paradas = Array.isArray(ai.paradas) ? ai.paradas : [];
        // Asegura una parada de inicio y otra de fin.
        if (!paradas.some(p => p.tipo === 'inicio')) paradas.unshift({ tipo: 'inicio', hora: startTime, nombre: startLoc.name });
        if (!paradas.some(p => p.tipo === 'fin')) paradas.push({ tipo: 'fin', hora: '', nombre: endLoc.name });

        for (const it of paradas) {
            const tipo = (it.tipo || '').toLowerCase();
            if (tipo === 'inicio') {
                timeline.push({ type: 'departure', time: it.hora || startTime, name: startLoc.name || it.nombre || 'Punto de partida', icon: '🚗' });
                departureIdx = timeline.length - 1;
            } else if (tipo === 'fin') {
                timeline.push({ type: 'arrival', time: it.hora || startTime, name: endLoc.name || it.nombre || 'Destino final', icon: '🏁' });
                geoPoints.push({ lat: endLoc.lat, lng: endLoc.lng });
            } else if (tipo === 'comida') {
                const near = geoPoints[geoPoints.length - 1];
                let restaurant = null;
                try { restaurant = await searchNearbyRestaurant(near, 1500); } catch { /* sin restaurante */ }
                const lat = restaurant?.lat || near.lat;
                const lng = restaurant?.lng || near.lng;
                // Red de seguridad de horarios: almuerzo nunca antes de 14:00, cena nunca antes de 21:00.
                const kind = /cena/i.test(it.nombre || '') ? 'Cena' : 'Almuerzo';
                const hm = (it.hora || '').split(':').map(Number);
                const mins = hm.length === 2 ? hm[0] * 60 + hm[1] : null;
                let mealTime = it.hora;
                if (mins != null && kind === 'Almuerzo' && mins < 14 * 60) mealTime = '14:00';
                if (mins != null && kind === 'Cena' && mins < 21 * 60) mealTime = '21:00';
                timeline.push({
                    type: 'meal', mealTime: kind, time: mealTime,
                    name: restaurant ? `🍴 ${restaurant.name}` : `🍴 ${it.nombre || kind}`,
                    rating: restaurant?.rating || null, vicinity: restaurant?.vicinity || '',
                    lat, lng, icon: '🍴', note: it.motivo || '', origen: 'ia',
                });
                geoPoints.push({ lat, lng }); geoStepIdx.push(timeline.length - 1);
            } else if (tipo === 'lugar' || tipo === 'evento') {
                const poi = it.poi_id ? candById[it.poi_id] : null;
                if (poi && poi.lat != null) {
                    const hrs = it.duracion_min ? it.duracion_min / 60 : (VISIT_DURATION[poi.category] || 1.5);
                    timeline.push({
                        type: 'poi', time: it.hora, name: poi.name, category: poi.category,
                        visitHours: hrs, visitDurationText: `${Math.round(hrs * 10) / 10}h visita`,
                        icon: tipo === 'evento' ? '🎪' : categoryEmoji(poi.category),
                        lat: poi.lat, lng: poi.lng, poiId: poi.id, rating: poi.rating,
                        note: it.motivo || '', descripcion: it.descripcion || '',
                        origen: it.origen || (fixedIds.includes(poi.id) ? 'fijado' : 'ia'),
                    });
                    optimizedPois.push({ lat: poi.lat, lng: poi.lng, name: poi.name });
                    geoPoints.push({ lat: poi.lat, lng: poi.lng }); geoStepIdx.push(timeline.length - 1);
                } else {
                    // Evento sin lugar geolocalizable: parada informativa.
                    timeline.push({ type: 'free', time: it.hora, name: it.nombre, icon: tipo === 'evento' ? '🎪' : '✨', note: it.motivo || '', descripcion: it.descripcion || '', origen: it.origen || 'evento_fecha', eventoFecha: dayDate });
                }
            } else if (tipo !== 'trayecto') {
                timeline.push({ type: 'free', time: it.hora, name: it.nombre, icon: '✨', note: it.motivo || '', origen: it.origen || 'ia' });
            }
        }

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
            await new Promise(r => setTimeout(r, 120));
        }
        if (departureIdx >= 0 && legs[0]) timeline[departureIdx].leg = legs[0];
        geoStepIdx.forEach((idx, k) => { if (legs[k + 1]) timeline[idx].leg = legs[k + 1]; });

        const totalDurationSec = legs.reduce((a, b) => a + (b.durationSec || 0), 0);
        return { timeline, optimizedPois, legs, totalDurationSec };
    };

    const canGenerate = () => {
        if (!startId || !endId) return false;
        if (mode === 'ordenar') return fixedIds.length >= 2;
        return fixedIds.length > 0 || activePois.some(p => !assignedByPoi[p.id]);
    };

    const handleGenerate = async () => {
        if (!startId || !endId) return toast('Elige el punto de inicio y fin del día.', 'info');
        if (!apiIsLoaded) return toast('Google Maps aún cargando. Espera un momento.', 'info');
        if (mode === 'ordenar' && fixedIds.length < 2) return toast('Fija al menos 2 lugares para el modo "Solo mis lugares".', 'info');

        const startLoc = allLocations.find(l => l.id === startId);
        const endLoc = allLocations.find(l => l.id === endId);
        const nDays = Math.max(1, Math.min(14, parseInt(aiDays, 10) || 1));
        const locationBias = trip.destinationLat && trip.destinationLng ? { lat: trip.destinationLat, lng: trip.destinationLng } : null;

        // Instrucciones = texto libre + eventos fijados por el usuario.
        let instructions = aiInstructions.trim();
        if (fixedEvents.length) instructions += `${instructions ? ' ' : ''}Incluye sí o sí estos eventos: ${fixedEvents.join(', ')}.`;

        setAiLoading(true);
        const newDays = [];
        const usedGlobal = new Set(); // ids usados en esta tanda (para varios días)
        const allEvents = [];
        let lastSuggestions = [];
        try {
            for (let k = 0; k < nDays; k++) {
                const dayNumber = itineraries.length + k + 1;
                const date = k === 0 ? (dayDate || null) : (dayDate ? addDaysISO(dayDate, k) : null);

                // Fijados de este día (solo el día 1; los siguientes se completan solos).
                const fixed = (k === 0 ? fixedIds : []).map(poiById).filter(Boolean)
                    .map(p => ({ id: p.id, name: p.name, category: p.category, zona: zonaByPoi[p.id], lat: p.lat, lng: p.lng }));
                const fixedSet = new Set(fixed.map(f => f.id));

                // Candidatos = activos no fijados, no asignados a otros días, no usados en esta tanda.
                const candidatesPois = mode === 'ordenar' ? [] : activePois.filter(p =>
                    !fixedSet.has(p.id) && !assignedByPoi[p.id] && !usedGlobal.has(p.id));
                const candidates = candidatesPois.map(p => ({ id: p.id, name: p.name, category: p.category, zona: zonaByPoi[p.id], rating: p.rating, lat: p.lat, lng: p.lng }));

                if (fixed.length === 0 && candidates.length === 0) break;

                // Eventos que coinciden con la fecha de ESTE día.
                const dayEvents = date ? (trip.eventos || []).filter(e => {
                    const ini = e.fechaInicio || e.fechaFin, fin = e.fechaFin || e.fechaInicio;
                    return ini && date >= ini && date <= fin;
                }).map(e => ({ nombre: e.nombre, fechas: (e.fechaInicio || '') + (e.fechaFin && e.fechaFin !== e.fechaInicio ? ` a ${e.fechaFin}` : ''), notas: e.notas })) : [];

                const candById = {};
                [...fixed, ...candidates].forEach(c => { candById[c.id] = c; });

                const ai = await generateAiItinerary({
                    destination: trip.destination || '',
                    dayNumber, dayDate: date,
                    tripStart: trip.startDate || null, tripEnd: trip.endDate || null, totalDays: nDays,
                    startTime, mode,
                    start: { name: startLoc.name, lat: startLoc.lat, lng: startLoc.lng },
                    end: { name: endLoc.name, lat: endLoc.lat, lng: endLoc.lng },
                    fixed, candidates,
                    assignedElsewhere: Object.keys(assignedByPoi).map(id => poiById(id)?.name).filter(Boolean),
                    events: dayEvents,
                    instructions,
                });
                if (Array.isArray(ai.events)) allEvents.push(...ai.events);
                lastSuggestions = ai.suggestions || [];

                const built = await buildFromParadas(ai, startLoc, endLoc, candById);
                newDays.push({
                    id: k === 0 && editingDay ? editingDay : `${Date.now()}-${k}`,
                    title: title || `Día ${dayNumber}`,
                    fecha: date, summary: ai.resumen_logica || '', avisos: Array.isArray(ai.avisos) ? ai.avisos : [],
                    startTime, startId, endId, startLoc, endLoc,
                    optimizedPois: built.optimizedPois, legs: built.legs, timeline: built.timeline, totalDurationSec: built.totalDurationSec,
                });
                built.timeline.forEach(s => { if (s.type === 'poi' && s.poiId) usedGlobal.add(s.poiId); });
            }

            if (newDays.length === 0) { toast('La IA no encontró una combinación válida.', 'info'); return; }

            const existingIndex = itineraries.findIndex(i => i.id === editingDay);
            let updatedList = [...itineraries];
            if (existingIndex >= 0) { updatedList[existingIndex] = newDays[0]; updatedList = [...updatedList, ...newDays.slice(1)]; }
            else updatedList = [...updatedList, ...newDays];
            store.updateTrip(trip.id, { itineraries: updatedList });
            setEditingDay(null);

            const seen = new Set();
            setAiEvents(allEvents.filter(e => e?.name && !seen.has(e.name) && seen.add(e.name)));
            const resolved = await resolveSuggestions(lastSuggestions, { destination: trip.destination, locationBias });
            const existingPlaceIds = new Set(trip.pois.map(p => p.placeId).filter(Boolean));
            setAiSuggestions(resolved.filter(r => !r.placeId || !existingPlaceIds.has(r.placeId)));
            if (newDays.length > 1) toast(`Se han generado ${newDays.length} días.`, 'success');
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
            phoneNumber: place.phoneNumber || null, priceLevel: place.priceLevel ?? null, types: place.types || [],
        });
        toast(`"${place.name}" añadido al viaje.`, 'success');
        setAiSuggestions(prev => prev.filter(s => s.placeId !== place.placeId));
    };

    // ----- Editor DnD de un itinerario existente -----
    const recalcTimesFrom = (timeline, anchorIdx) => {
        const updated = [...timeline];
        let currentTime = updated[anchorIdx].time || startTime;
        for (let i = anchorIdx; i < updated.length; i++) {
            const step = updated[i];
            updated[i] = { ...step, time: currentTime };
            const visitMins = (step.visitHours || 0) * 60;
            if (step.type === 'poi') {
                currentTime = addMinutes(currentTime, visitMins || 90);
                const nextLeg = updated[i + 1]?.leg;
                if (nextLeg) currentTime = addMinutes(currentTime, nextLeg.durationMins);
            } else if (step.type === 'meal') {
                currentTime = addMinutes(currentTime, step.mealTime === 'Cena' ? 90 : 75);
            } else if (step.type === 'departure') {
                currentTime = addMinutes(currentTime, step.leg?.durationMins || 0);
            }
        }
        return updated;
    };
    const pinEnds = (list) => {
        const dep = list.filter(s => s.type === 'departure');
        const arr = list.filter(s => s.type === 'arrival');
        const mid = list.filter(s => s.type !== 'departure' && s.type !== 'arrival');
        return [...dep, ...mid, ...arr];
    };
    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        setEditTimeline(prev => {
            const oldIdx = prev.findIndex(s => s.dndId === active.id);
            const newIdx = prev.findIndex(s => s.dndId === over.id);
            if (oldIdx < 0 || newIdx < 0) return prev;
            return recalcTimesFrom(pinEnds(arrayMove(prev, oldIdx, newIdx)), 0);
        });
    };
    const updateStepTime = (idx, newTime) => {
        setEditTimeline(prev => recalcTimesFrom(prev.map((s, i) => i === idx ? { ...s, time: newTime } : s), idx));
    };
    const deleteStep = (idx) => setEditTimeline(prev => prev.filter((_, i) => i !== idx));
    const handleEditExisting = (itinerary) => {
        setEditingItinerary(itinerary.id);
        setEditTimeline((itinerary.timeline || []).map((s, i) => ({ ...JSON.parse(JSON.stringify(s)), dndId: `step-${i}-${Math.random().toString(36).slice(2, 8)}` })));
    };
    const saveEditedItinerary = (itineraryId) => {
        const idx = itineraries.findIndex(i => i.id === itineraryId);
        if (idx < 0) return;
        const updated = [...itineraries];
        const cleanTimeline = editTimeline.map(({ dndId, ...rest }) => rest); // eslint-disable-line no-unused-vars
        updated[idx] = { ...updated[idx], timeline: cleanTimeline };
        store.updateTrip(trip.id, { itineraries: updated });
        setEditingItinerary(null); setEditTimeline(null);
    };
    const deleteItinerary = (id) => {
        if (!confirm('¿Eliminar este itinerario?')) return;
        store.updateTrip(trip.id, { itineraries: itineraries.filter(i => i.id !== id) });
    };

    // ----- Días-semilla importados (sin timeline aún) -----
    const RECOMMENDED_DAY_MIN = 10 * 60;
    const estimateSeedDay = (day) => {
        const stops = (day.paradas || []).map(poiById).filter(Boolean);
        const base = trip.accommodations.find(a => a.id === day.baseId) || trip.accommodations.find(a => a.id === trip.selectedAccommodation) || trip.accommodations.find(a => a.isActive !== false);
        const visitMin = stops.reduce((sum, p) => sum + (p.duracionEstimadaMin || (VISIT_DURATION[p.category] || 1.5) * 60), 0);
        const seq = [base, ...stops, base].filter(Boolean);
        let driveMin = 0;
        for (let i = 0; i < seq.length - 1; i++) { const m = haversineMeters(seq[i], seq[i + 1]); if (m !== Infinity) driveMin += (m / 1000) / 45 * 60; }
        const totalMin = visitMin + driveMin;
        return { stops, totalMin, overBudget: totalMin > RECOMMENDED_DAY_MIN };
    };
    const eventsForSeedDay = (day) => {
        if (!day.fecha) return [];
        return (trip.eventos || []).filter(e => { const ini = e.fechaInicio || e.fechaFin, fin = e.fechaFin || e.fechaInicio; return ini && day.fecha >= ini && day.fecha <= fin; });
    };

    // ===================== RENDER: PLANIFICAR RUTA =====================
    if (editingDay) {
        const editingDayNumber = itineraries.findIndex(i => i.id === editingDay) + 1;
        const filteredList = activePois.filter(p =>
            (zoneFilter === 'all' || zonaByPoi[p.id] === zoneFilter) &&
            (catFilter === 'all' || p.category === catFilter));
        const q = search.trim().toLowerCase();
        const searchFiltered = q ? filteredList.filter(p => p.name.toLowerCase().includes(q) || (p.municipio || '').toLowerCase().includes(q)) : filteredList;
        const fixedPois = fixedIds.map(poiById).filter(Boolean);
        const listPois = searchFiltered.filter(p => !fixedIds.includes(p.id));
        // Categorías presentes entre los lugares activos (para el filtro rápido).
        const presentCats = [...new Set(activePois.map(p => p.category))].map(id => CATEGORY_MAP[id]).filter(Boolean);
        const mapCenter = { lat: trip.destinationLat || activePois[0]?.lat || 36.5, lng: trip.destinationLng || activePois[0]?.lng || -6.1 };
        const popupPoi = mapPopupId ? poiById(mapPopupId) : null;

        const pinColor = (p) => fixedIds.includes(p.id) ? PIN_FIXED : (assignedByPoi[p.id] ? PIN_OTHER : PIN_UNSET);
        const dimmed = (p) => (zoneFilter !== 'all' && zonaByPoi[p.id] !== zoneFilter) || (catFilter !== 'all' && p.category !== catFilter);

        const cta = mode === 'ordenar'
            ? (fixedIds.length < 2 ? 'Fija 2+ lugares' : `✨ Ordenar ${fixedIds.length} lugares`)
            : (aiDays > 1 ? `✨ Generar ${aiDays} días` : (fixedIds.length ? `✨ Generar día · ${fixedIds.length} fijados` : '✨ Generar día con IA'));

        return (
            <div className="animate-fade-in-up" style={{ paddingBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-sm)' }}>
                    <div>
                        <h2 className="text-subtitle">Planificar Ruta</h2>
                        <p className="text-caption text-secondary" style={{ marginTop: 2 }}>
                            {trip.destination ? `Viaje a ${trip.destination.split(',')[0]} · ` : ''}Toca un lugar para fijarlo 📌 al día. La IA hará el resto.
                        </p>
                    </div>
                    <button className="text-caption text-secondary" onClick={() => setEditingDay(null)}>Cancelar</button>
                </div>

                {/* Config del día */}
                <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                    <div>
                        <label className="field-label">Día</label>
                        <input className="input-field" style={{ padding: '10px 12px', width: '100%', boxSizing: 'border-box' }} value={title} onChange={e => setTitle(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <label className="field-label">Fecha</label>
                            <input className="input-field" type="date" style={{ padding: '10px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} value={dayDate} onChange={e => setDayDate(e.target.value)} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <label className="field-label">Hora inicio</label>
                            <input className="input-field" type="time" style={{ padding: '10px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} value={startTime} onChange={e => setStartTime(e.target.value)} />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-md)', marginTop: 'var(--space-md)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <label className="field-label">Salida</label>
                            <select className="input-field" style={{ padding: '10px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} value={startId} onChange={e => setStartId(e.target.value)}>
                                <option value="">Seleccionar...</option>
                                {allLocations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <label className="field-label">Regreso</label>
                            <select className="input-field" style={{ padding: '10px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} value={endId} onChange={e => setEndId(e.target.value)}>
                                <option value="">Seleccionar...</option>
                                {allLocations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Aviso de eventos que coinciden con la fecha */}
                    {eventsForDate.length > 0 && (
                        <div style={{ marginTop: 'var(--space-md)' }}>
                            <button onClick={() => setEventsOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'var(--color-gold-light)', border: '1px solid var(--color-gold)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', cursor: 'pointer', textAlign: 'left' }}>
                                <PartyPopper size={15} style={{ color: 'var(--color-gold)', flexShrink: 0 }} />
                                <span className="text-caption" style={{ fontWeight: 700, flex: 1 }}>{eventsForDate.length} evento(s) coinciden con el {fmtDate(dayDate)}</span>
                                <span className="text-caption text-secondary">{eventsOpen ? '▲' : '▼'}</span>
                            </button>
                            {eventsOpen && (
                                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {eventsForDate.map(ev => {
                                        const on = fixedEvents.includes(ev.nombre);
                                        return (
                                            <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 4 }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div className="text-caption" style={{ fontWeight: 700 }}>{ev.nombre}</div>
                                                    {ev.notas && <div className="text-caption text-secondary truncate">{ev.notas}</div>}
                                                </div>
                                                <button className={`chip ${on ? 'active' : ''}`} style={{ fontSize: 11, padding: '4px 10px' }}
                                                    onClick={() => setFixedEvents(prev => on ? prev.filter(n => n !== ev.nombre) : [...prev, ev.nombre])}>
                                                    {on ? '📌 Fijado' : 'Fijar'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                    {!dayDate && (
                        <p className="text-caption text-tertiary" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                            <Calendar size={12} /> Selecciona la fecha para incluir eventos de esos días.
                        </p>
                    )}
                </div>

                {/* Modo */}
                <div className="segmented" style={{ display: 'flex', gap: 4, background: 'var(--bg-tertiary)', padding: 4, borderRadius: 'var(--radius-full)', marginBottom: 8 }}>
                    <button onClick={() => setMode('completar')} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13, background: mode === 'completar' ? 'var(--bg-primary)' : 'transparent', color: mode === 'completar' ? 'var(--color-primary)' : 'var(--text-secondary)', boxShadow: mode === 'completar' ? 'var(--shadow-sm)' : 'none' }}>✨ IA completa el día</button>
                    <button onClick={() => setMode('ordenar')} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13, background: mode === 'ordenar' ? 'var(--bg-primary)' : 'transparent', color: mode === 'ordenar' ? 'var(--color-primary)' : 'var(--text-secondary)', boxShadow: mode === 'ordenar' ? 'var(--shadow-sm)' : 'none' }}>📌 Solo mis lugares</button>
                </div>
                <p className="text-caption text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
                    {mode === 'completar'
                        ? 'La IA respetará tus lugares fijados, completará el día con sitios cercanos y añadirá paradas de comida.'
                        : 'La IA solo ordenará y dará horarios a tus lugares fijados (mínimo 2) y añadirá comidas. No sugiere sitios nuevos.'}
                </p>

                {/* Buscador con sugerencias */}
                <div className="input-group" style={{ marginBottom: searchSug.length ? 8 : 'var(--space-md)' }}>
                    <div className="input-icon"><Search size={18} /></div>
                    <input className="input-field" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()}
                        placeholder="Buscar lugar o pedir a la IA... ej. 'pueblo blanco'" />
                    {search && <button onClick={runSearch} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-full)', padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{searchLoading ? '...' : 'IA'}</button>}
                </div>
                {searchSug.length > 0 && (
                    <div className="card" style={{ marginBottom: 'var(--space-md)', border: '1px solid var(--color-primary)' }}>
                        <p className="text-caption" style={{ fontWeight: 800, color: 'var(--color-primary)', marginBottom: 8 }}>✨ Sugerencias de la IA (no están en tu lista)</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {searchSug.map(s => (
                                <div key={s.placeId} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <img src={s.photoUrl || getPlaceholderImage(s.name)} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="text-caption truncate" style={{ fontWeight: 700 }}>{s.name}</div>
                                        <div className="text-caption text-secondary truncate">{s.address}</div>
                                    </div>
                                    <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: 12, width: 'auto', flexShrink: 0 }} onClick={() => addSearchSuggestion(s)}><Plus size={14} /> Fijar</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Mini-mapa real con pines de estado */}
                {apiIsLoaded && activePois.length > 0 && (
                    <div style={{ position: 'relative', height: 200, borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
                        <GMap defaultCenter={mapCenter} defaultZoom={9} mapId="travel-map" gestureHandling="greedy" disableDefaultUI style={{ width: '100%', height: '100%' }}>
                            {activePois.filter(p => p.lat != null).map(p => (
                                <AdvancedMarker key={p.id} position={{ lat: p.lat, lng: p.lng }} onClick={() => setMapPopupId(p.id)}>
                                    <div style={{ width: 20, height: 20, borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', background: pinColor(p), border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.3)', opacity: dimmed(p) ? 0.35 : 1 }} />
                                </AdvancedMarker>
                            ))}
                            {popupPoi && (
                                <InfoWindow position={{ lat: popupPoi.lat, lng: popupPoi.lng }} onCloseClick={() => setMapPopupId(null)}>
                                    <div style={{ width: 190, padding: 2 }}>
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <img src={popupPoi.photoUrl || getPlaceholderImage(popupPoi.name)} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 800, fontSize: 13, lineHeight: 1.2 }}>{popupPoi.name}</div>
                                                <div style={{ fontSize: 10, color: '#64748b' }}>{CATEGORY_MAP[popupPoi.category]?.label || 'Lugar'}{popupPoi.duracionEstimadaMin ? ` · ${formatDuration(popupPoi.duracionEstimadaMin * 60)}` : ''}</div>
                                            </div>
                                        </div>
                                        {assignedByPoi[popupPoi.id] && assignedByPoi[popupPoi.id] !== editingDayNumber && (
                                            <div style={{ fontSize: 10, color: PIN_OTHER, fontWeight: 800, marginTop: 4 }}>Día {assignedByPoi[popupPoi.id]} ✓</div>
                                        )}
                                        <button className="btn btn-primary" style={{ width: '100%', marginTop: 6, padding: '6px', fontSize: 12, borderRadius: 6 }}
                                            onClick={() => { toggleFixed(popupPoi.id); setMapPopupId(null); }}>
                                            {fixedIds.includes(popupPoi.id) ? 'Quitar del día' : '📌 Fijar al día'}
                                        </button>
                                    </div>
                                </InfoWindow>
                            )}
                        </GMap>
                        <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 8, background: 'rgba(255,255,255,.92)', borderRadius: 'var(--radius-full)', padding: '4px 10px', fontSize: 10, fontWeight: 700 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: PIN_UNSET }} /> Sin elegir</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: PIN_FIXED }} /> Fijado</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: PIN_OTHER }} /> Otro día</span>
                        </div>
                    </div>
                )}

                {/* Chips de zona */}
                {zones.length > 1 && (
                    <div className="chip-row" style={{ marginBottom: 8 }}>
                        <button className={`chip ${zoneFilter === 'all' ? 'active' : ''}`} onClick={() => setZoneFilter('all')}>📍 Todo {activePois.length}</button>
                        {zones.map(z => (
                            <button key={z.name} className={`chip ${zoneFilter === z.name ? 'active' : ''}`} onClick={() => setZoneFilter(z.name)}>
                                {z.name.split(' y ')[0].split(',')[0]} {z.count}
                            </button>
                        ))}
                    </div>
                )}

                {/* Chips de categoría (playas, pueblos, miradores…) */}
                {presentCats.length > 1 && (
                    <div className="chip-row" style={{ marginBottom: 'var(--space-md)' }}>
                        <button className={`chip ${catFilter === 'all' ? 'active' : ''}`} onClick={() => setCatFilter('all')}>Todas</button>
                        {presentCats.map(c => (
                            <button key={c.id} className={`chip ${catFilter === c.id ? 'active' : ''}`} onClick={() => setCatFilter(c.id)}>
                                {c.emoji} {c.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Fijados */}
                {fixedPois.length > 0 && (
                    <div style={{ marginBottom: 'var(--space-md)' }}>
                        <p className="text-caption" style={{ fontWeight: 800, color: 'var(--color-primary)', marginBottom: 6 }}>📌 Fijados para este día ({fixedPois.length})</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {fixedPois.map(p => <PoiRow key={p.id} poi={p} state="fixed" onToggle={() => toggleFixed(p.id)} onOpen={() => setPoiDetail(p)} />)}
                        </div>
                    </div>
                )}

                {/* Lista */}
                <p className="text-caption" style={{ fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Lugares de tu lista</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {listPois.map(p => (
                        <PoiRow key={p.id} poi={p}
                            state={assignedByPoi[p.id] && assignedByPoi[p.id] !== editingDayNumber ? 'other' : 'unset'}
                            dayNum={assignedByPoi[p.id]}
                            onToggle={() => toggleFixed(p.id)} onOpen={() => setPoiDetail(p)} />
                    ))}
                    {listPois.length === 0 && <p className="text-caption text-tertiary" style={{ padding: '8px 0' }}>No hay más lugares en esta zona/búsqueda.</p>}
                </div>

                {/* Otras indicaciones */}
                <div style={{ marginTop: 'var(--space-lg)' }}>
                    <p className="text-caption" style={{ fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Otras indicaciones</p>
                    <textarea className="input-field" rows={2} style={{ padding: '10px 12px', resize: 'vertical', fontSize: 13 }}
                        placeholder="Opcional: sin madrugar, terraza para cenar, evitar mucho coche..." value={aiInstructions} onChange={e => setAiInstructions(e.target.value)} />
                </div>

                {/* CTA: sticky (siempre visible, pero en el flujo: baja con el contenido y no tapa las indicaciones) */}
                <div style={{ position: 'sticky', bottom: 'calc(var(--nav-height) + 8px)', marginTop: 'var(--space-lg)', padding: '10px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', display: 'flex', gap: 10, alignItems: 'center', zIndex: 30 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <button type="button" className="btn btn-outline" style={{ width: 36, height: 40, padding: 0, borderRadius: 10 }} onClick={() => setAiDays(d => Math.max(1, (parseInt(d, 10) || 1) - 1))}>−</button>
                        <span style={{ width: 24, textAlign: 'center', fontWeight: 800 }}>{aiDays}</span>
                        <button type="button" className="btn btn-outline" style={{ width: 36, height: 40, padding: 0, borderRadius: 10 }} onClick={() => setAiDays(d => Math.min(14, (parseInt(d, 10) || 1) + 1))}>+</button>
                    </div>
                    <button className="btn btn-primary" style={{ flex: 1, height: 48 }} onClick={handleGenerate} disabled={aiLoading || !canGenerate()}>
                        {aiLoading ? '🧠 Pensando...' : cta}
                    </button>
                </div>

                {poiDetail && (
                    <PoiDetailModal poi={trip.pois.find(p => p.id === poiDetail.id) || poiDetail} trip={trip}
                        onClose={() => setPoiDetail(null)} onDelete={() => setPoiDetail(null)}
                        onUpdate={(u) => store.updatePoi(trip.id, poiDetail.id, u)}
                        onSaveDistances={(r) => store.saveDistances(trip.id, r)} />
                )}
            </div>
        );
    }

    // ===================== RENDER: EDITOR DnD =====================
    if (editingItinerary && editTimeline) {
        const itinerary = itineraries.find(i => i.id === editingItinerary);
        return (
            <div className="animate-fade-in-up">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                    <h2 className="text-subtitle">✏️ Editar: {itinerary?.title}</h2>
                    <button className="text-caption text-secondary" onClick={() => { setEditingItinerary(null); setEditTimeline(null); }}>Cancelar</button>
                </div>
                <p className="text-caption text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
                    Arrastra <GripVertical size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> para reordenar o pulsa ✕ para quitar. Los horarios se recalculan solos.
                </p>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={editTimeline.map(s => s.dndId)} strategy={verticalListSortingStrategy}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 'var(--space-lg)' }}>
                            {editTimeline.map((step, idx) => (
                                <SortableStep key={step.dndId} step={step} idx={idx} total={editTimeline.length} onDelete={deleteStep} onTimeChange={updateStepTime} />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
                <button className="btn btn-primary btn-full" onClick={() => saveEditedItinerary(editingItinerary)}>💾 Guardar Cambios</button>
            </div>
        );
    }

    // ===================== RENDER: LISTA DE DÍAS =====================
    return (
        <div className="animate-fade-in-up">
            <div style={{ marginBottom: 'var(--space-md)' }}>
                <h2 className="text-subtitle" style={{ marginBottom: 4 }}>Itinerarios Diarios</h2>
                <p className="text-body text-secondary">Genera días con la IA: respeta tus lugares fijados, razona la logística y añade comidas.</p>
            </div>

            {aiEvents.length > 0 && (
                <div className="card animate-fade-in-up" style={{ marginBottom: 'var(--space-md)', border: '1px solid var(--color-gold)', background: 'var(--color-gold-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PartyPopper size={18} style={{ color: 'var(--color-gold)' }} /><span style={{ fontWeight: 800, fontSize: 14 }}>Eventos en tus fechas</span></div>
                        <button onClick={() => setAiEvents([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={16} /></button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                        {aiEvents.map((ev, i) => (
                            <div key={i} style={{ borderLeft: '3px solid var(--color-gold)', paddingLeft: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700, fontSize: 13 }}>{ev.name}</span>
                                    {ev.date && <span className="text-caption" style={{ color: 'var(--color-gold)', fontWeight: 700 }}>{ev.date}</span>}
                                </div>
                                <p className="text-caption text-secondary" style={{ lineHeight: 1.5 }}>{ev.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {aiSuggestions.length > 0 && (
                <div className="card animate-fade-in-up" style={{ marginBottom: 'var(--space-md)', border: '1px solid var(--color-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={18} style={{ color: 'var(--color-primary)' }} /><span style={{ fontWeight: 800, fontSize: 14 }}>La IA también te recomienda</span></div>
                        <button onClick={() => setAiSuggestions([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={16} /></button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        {aiSuggestions.map(s => (
                            <div key={s.placeId} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="truncate" style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                                    <p className="text-caption text-secondary truncate">{s.aiReason}</p>
                                </div>
                                <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: 12, width: 'auto', flexShrink: 0 }} onClick={() => addSuggestionToTrip(s)}><Plus size={14} /> Añadir</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div>
                {itineraries.map((itinerary) => {
                    const isSeed = itinerary.seed && !(itinerary.timeline && itinerary.timeline.length);
                    if (isSeed) {
                        const est = estimateSeedDay(itinerary);
                        const dayEvents = eventsForSeedDay(itinerary);
                        return (
                            <div key={itinerary.id} className="card" style={{ marginBottom: 'var(--space-md)', borderLeft: '3px solid var(--color-primary)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                                    <div>
                                        <h3 style={{ fontWeight: 700, fontSize: 17 }}>{itinerary.title || `Día ${itinerary.dia || ''}`}</h3>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                                            {itinerary.fecha && <span className="text-caption text-secondary">{fmtDate(itinerary.fecha)}</span>}
                                            <span className="text-caption" style={{ fontWeight: 700, color: est.overBudget ? 'var(--color-danger)' : 'var(--color-primary)' }}>~{formatDuration(est.totalMin * 60)} estimadas</span>
                                        </div>
                                    </div>
                                    <button style={{ padding: 8, borderRadius: 8, color: 'var(--color-danger)' }} onClick={() => deleteItinerary(itinerary.id)}><Trash2 size={16} /></button>
                                </div>
                                {dayEvents.map(ev => (
                                    <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--color-gold-light)', border: '1px solid var(--color-gold)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: 8 }}>
                                        <PartyPopper size={15} style={{ color: 'var(--color-gold)', flexShrink: 0, marginTop: 2 }} />
                                        <div><div style={{ fontWeight: 700, fontSize: 13 }}>{ev.nombre}</div><div className="text-caption text-secondary">{ev.notas || 'Evento en tus fechas.'}</div></div>
                                    </div>
                                ))}
                                {est.stops.length > 0 ? (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                                        {est.stops.map(p => (
                                            <button key={p.id} onClick={() => setPoiDetail(p)} className="chip" style={{ background: (CATEGORY_MAP[p.category]?.color || '#6b7280') + '20', color: CATEGORY_MAP[p.category]?.color || '#334155', border: 'none', cursor: 'pointer' }}>
                                                {CATEGORY_MAP[p.category]?.emoji || '📍'} {p.name}
                                            </button>
                                        ))}
                                    </div>
                                ) : <p className="text-caption text-tertiary" style={{ marginBottom: 12 }}>Sin paradas todavía.</p>}
                                <button className="btn btn-primary btn-full" onClick={() => handlePlanSeedDay(itinerary)} disabled={est.stops.length === 0}>
                                    <Navigation size={16} /> Planificar este día
                                </button>
                            </div>
                        );
                    }

                    const mapsUrl = buildMapsUrl(itinerary.startLoc, itinerary.optimizedPois, itinerary.endLoc);
                    return (
                        <div key={itinerary.id} className="card" style={{ marginBottom: 'var(--space-md)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 12, marginBottom: 16 }}>
                                <div>
                                    <h3 style={{ fontWeight: 700, fontSize: 17 }}>{itinerary.title}</h3>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, color: 'var(--color-primary)', flexWrap: 'wrap' }}>
                                        {itinerary.fecha && <span className="text-caption text-secondary">{fmtDate(itinerary.fecha)}</span>}
                                        <span className="text-caption" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={13} /> Conducción {formatDuration(itinerary.totalDurationSec)}</span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {onShowOnMap && <button style={{ padding: 8, borderRadius: 8, color: 'var(--color-primary)', border: '1px solid var(--border-color)' }} onClick={() => onShowOnMap(itinerary)} title="Ver la ruta en el mapa"><Map size={15} /></button>}
                                    <button style={{ padding: 8, borderRadius: 8, color: 'var(--color-primary)', border: '1px solid var(--border-color)' }} onClick={() => handleEditExisting(itinerary)} title="Editar"><Edit3 size={15} /></button>
                                    <button style={{ padding: 8, borderRadius: 8, color: 'var(--color-danger)' }} onClick={() => deleteItinerary(itinerary.id)}><Trash2 size={16} /></button>
                                </div>
                            </div>

                            {/* Por qué este orden */}
                            {(itinerary.summary || (itinerary.avisos && itinerary.avisos.length > 0)) && (
                                <div style={{ background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginBottom: 16 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: itinerary.summary ? 6 : 0 }}>
                                        <Lightbulb size={15} style={{ color: 'var(--color-primary)' }} />
                                        <span className="text-caption" style={{ fontWeight: 800, color: 'var(--color-primary)' }}>Por qué este orden</span>
                                    </div>
                                    {itinerary.summary && <p className="text-caption text-secondary" style={{ lineHeight: 1.55 }}>{itinerary.summary}</p>}
                                    {(itinerary.avisos || []).map((a, i) => (
                                        <p key={i} className="text-caption" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', color: 'var(--color-danger)', marginTop: 6 }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {a}</p>
                                    ))}
                                </div>
                            )}

                            {mapsUrl && (
                                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16, textDecoration: 'none', fontSize: 13 }}>
                                    <Map size={15} /> Ver recorrido en Google Maps <ExternalLink size={13} />
                                </a>
                            )}

                            {/* Timeline */}
                            {(itinerary.timeline || []).map((step, i) => {
                                const isLast = i === itinerary.timeline.length - 1;
                                const dotColor = step.type === 'meal' ? '#f97316' : step.type === 'poi' ? 'var(--color-primary)' : step.type === 'free' ? 'var(--color-gold)' : '#6b7280';
                                const poiData = step.poiId ? trip.pois.find(p => p.id === step.poiId) : null;
                                return (
                                    <div key={i} style={{ display: 'flex', gap: 12 }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                            <div style={{ width: step.type === 'poi' ? 26 : 18, height: step.type === 'poi' ? 26 : 18, borderRadius: '50%', background: dotColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 'bold', flexShrink: 0 }}>
                                                {step.type === 'poi' ? (itinerary.timeline.slice(0, i).filter(s => s.type === 'poi').length + 1) : ''}
                                                {step.type === 'meal' && <Utensils size={10} />}
                                                {step.type === 'free' && <Sparkles size={10} />}
                                                {(step.type === 'departure' || step.type === 'arrival') && <Navigation size={9} />}
                                            </div>
                                            {!isLast && <div style={{ width: 2, flex: 1, background: 'var(--border-color)', margin: '4px 0', minHeight: 20 }} />}
                                        </div>
                                        <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14, minWidth: 0 }}>
                                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', cursor: poiData ? 'pointer' : 'default', flexWrap: 'wrap' }} onClick={() => poiData && setPoiDetail(poiData)}>
                                                <span style={{ fontSize: 12, fontWeight: 800, color: dotColor, fontVariantNumeric: 'tabular-nums', minWidth: 42 }}>{step.time}</span>
                                                <span style={{ fontWeight: 700, fontSize: 14, color: poiData ? 'var(--color-primary)' : 'inherit', textDecoration: poiData ? 'underline dotted' : 'none' }}>{step.name}</span>
                                                {step.origen && <OrigenBadge origen={step.origen} fecha={step.eventoFecha} />}
                                            </div>
                                            {step.visitDurationText && (
                                                <span className="text-caption text-secondary" style={{ marginLeft: 50, display: 'block' }}>
                                                    🕒 {step.visitDurationText}{step.leg && ` · ${step.leg.icon || '🚗'} ${step.leg.durationText}`}
                                                </span>
                                            )}
                                            {step.type === 'meal' && (
                                                <span className="text-caption" style={{ marginLeft: 50, display: 'block', fontWeight: 600, color: '#f97316' }}>
                                                    {step.mealTime}{step.rating && ` · ⭐ ${step.rating}`}{step.vicinity && ` · ${step.vicinity}`}
                                                </span>
                                            )}
                                            {step.note && (
                                                <span className="text-caption text-secondary" style={{ marginLeft: 50, display: 'flex', gap: 4, lineHeight: 1.45, marginTop: 3 }}>
                                                    <Lightbulb size={12} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-gold)' }} /> {step.note}
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
                        <p className="text-body text-tertiary">Aún no has creado días. Pulsa el botón para planificar tu primer día con la IA.</p>
                    </div>
                )}
            </div>

            <button className="btn btn-outline btn-full" onClick={handleCreateNew} style={{ marginTop: 'var(--space-lg)' }}>
                <Plus size={16} /> Planificar un día
            </button>

            {poiDetail && (
                <PoiDetailModal poi={trip.pois.find(p => p.id === poiDetail.id) || poiDetail} trip={trip}
                    onClose={() => setPoiDetail(null)} onDelete={() => setPoiDetail(null)}
                    onUpdate={(u) => store.updatePoi(trip.id, poiDetail.id, u)} onSaveDistances={(r) => store.saveDistances(trip.id, r)} />
            )}
        </div>
    );
}

// Suma días a una fecha ISO (yyyy-mm-dd).
function addDaysISO(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return null;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

// Fila de lugar en el planificador (fijado / sin elegir / asignado a otro día).
function PoiRow({ poi, state, dayNum, onToggle, onOpen }) {
    const border = state === 'fixed' ? '1px solid var(--color-primary)' : '1px solid transparent';
    return (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, border }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onOpen}>
                <div className="poi-img" style={{ width: 44, height: 44, flexShrink: 0 }}>
                    <img src={poi.photoUrl || getPlaceholderImage(poi.name)} alt="" onError={e => { e.currentTarget.src = getPlaceholderImage(poi.name); }} />
                </div>
                <div style={{ minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>{CATEGORY_MAP[poi.category]?.emoji || '📍'}</span><span className="truncate">{poi.name}</span>
                    </div>
                    <div className="text-caption text-secondary truncate">
                        {CATEGORY_MAP[poi.category]?.label || 'Lugar'}{poi.municipio ? ` · ${poi.municipio}` : ''}
                    </div>
                </div>
            </div>
            <button onClick={onToggle} aria-label={state === 'fixed' ? 'Quitar del día' : 'Fijar al día'} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                {state === 'fixed'
                    ? <span className="chip" style={{ fontSize: 11, padding: '4px 10px', background: 'var(--color-primary)', color: '#fff', fontWeight: 800 }}>📌 Fijado</span>
                    : state === 'other'
                        ? <span className="chip" style={{ fontSize: 11, padding: '4px 10px', background: '#10b98120', color: '#059669', fontWeight: 800 }}>Día {dayNum} ✓</span>
                        : <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--text-tertiary)', display: 'inline-block' }} />}
            </button>
        </div>
    );
}
