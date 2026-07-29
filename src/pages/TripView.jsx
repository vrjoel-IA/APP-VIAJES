import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Search, Plus, MapPin, Trash2, Star, Clock, ExternalLink,
    Hotel, BarChart3, Map as MapIcon, List, X, Navigation, Heart,
    CheckCircle2, ChevronDown, ChevronUp, Trophy, ArrowRight, UserPlus, Download, BookOpen
} from 'lucide-react';
import { Map, AdvancedMarker, InfoWindow, useApiIsLoaded } from '@vis.gl/react-google-maps';
import PageHeader from '../components/PageHeader';
import ItineraryTab from '../components/ItineraryTab';
import GuideTab from '../components/GuideTab';
import BulkImportModal from '../components/BulkImportModal';
import ImportTripModal from '../components/ImportTripModal';
import PoiDetailModal from '../components/PoiDetailModal';
import AccommodationDetailModal from '../components/AccommodationDetailModal';
import ShareTripModal from '../components/ShareTripModal';
import RouteOverlay from '../components/RouteOverlay';
import { useTripStore } from '../store/useTripStore';
import { exportFromInternal, haversineMeters } from '../lib/tripSchema';
import { searchPlacesByText, getPlaceDetails } from '../lib/places';
import { computeDrivingMatrix, findDistance } from '../lib/distances';
import { guessCategory } from '../lib/categorize';
import { toast } from '../lib/toast';
import { CATEGORIES, CATEGORY_MAP, formatDuration, getPlaceholderImage } from '../utils/constants';
import './TripView.css';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

export default function TripView() {
    const { tripId } = useParams();
    const navigate = useNavigate();
    const store = useTripStore();
    const trip = store.trips.find(t => t.id === tripId);
    const [tab, setTab] = useState('places');
    const [showAddPoi, setShowAddPoi] = useState(false);
    const [showAddAcc, setShowAddAcc] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState('all');
    const [poiSearch, setPoiSearch] = useState('');
    const [sortBy, setSortBy] = useState('alpha'); // alpha | distance | duration
    const [onlyImprescindible, setOnlyImprescindible] = useState(false);
    const [hideVisitados, setHideVisitados] = useState(false);
    const [showDescartados, setShowDescartados] = useState(false);
    const [selectedMarker, setSelectedMarker] = useState(null);
    const [poiDetail, setPoiDetail] = useState(null);
    const [comparing, setComparing] = useState(false);
    const [comparisonResults, setComparisonResults] = useState(null);
    const [weightEssentialOnly, setWeightEssentialOnly] = useState(false);
    const [showBulkImport, setShowBulkImport] = useState(false);
    const [showImportTrip, setShowImportTrip] = useState(false);
    const [accDetail, setAccDetail] = useState(null);
    const [dayPickerPoi, setDayPickerPoi] = useState(null); // POI que se está añadiendo a un día
    const [mapCenter, setMapCenter] = useState({
        lat: trip?.destinationLat || 28.2916,
        lng: trip?.destinationLng || -16.6291,
    });
    const [measureSource, setMeasureSource] = useState(null);
    const [measureDest, setMeasureDest] = useState(null);
    const [measureMode, setMeasureMode] = useState('DRIVING');
    const [measureResult, setMeasureResult] = useState(null);
    const [routeItinerary, setRouteItinerary] = useState(null); // itinerario a dibujar en el mapa

    const mapRef = useRef(null);
    const comparisonRef = useRef(null);
    const apiIsLoaded = useApiIsLoaded();
    const repairingPhotos = useRef(new Set());
    const enrichingPhotos = useRef(new Set());
    const enrichRunning = useRef(false);

    // Auto-repara fotos rotas: vuelve a pedir la foto del lugar a Google (con el
    // parámetro correcto) y actualiza el POI. Se ejecuta una vez por lugar.
    const repairPhoto = useCallback(async (poi) => {
        if (!apiIsLoaded || !poi?.placeId || repairingPhotos.current.has(poi.id)) return;
        repairingPhotos.current.add(poi.id);
        try {
            const fresh = await getPlaceDetails(poi.placeId);
            if (fresh?.photoUrl) {
                store.updatePoi(trip.id, poi.id, { photoUrl: fresh.photoUrl, photos: fresh.photos });
            }
        } catch { /* sin foto disponible */ }
    }, [apiIsLoaded, store, trip?.id]);

    // Enriquece con fotos reales de Google los lugares que llegan sin foto (típico de la
    // investigación importada). Con placeId pide detalles; sin él busca por nombre+municipio.
    // También rellena rating, dirección, web, etc. si faltan. `photoTried` evita reintentos.
    const enrichPhoto = useCallback(async (poi) => {
        if (!apiIsLoaded || !trip || poi.photoUrl || poi.photoTried || enrichingPhotos.current.has(poi.id)) return;
        enrichingPhotos.current.add(poi.id);
        try {
            let fresh = null;
            if (poi.placeId) {
                fresh = await getPlaceDetails(poi.placeId);
            } else {
                const bias = trip.destinationLat && trip.destinationLng
                    ? { lat: trip.destinationLat, lng: trip.destinationLng } : null;
                const q = [poi.name, poi.municipio].filter(Boolean).join(', ');
                const results = await searchPlacesByText(q, { locationBias: bias, limit: 1 });
                fresh = results[0] || null;
            }
            if (fresh && (fresh.photoUrl || fresh.placeId)) {
                store.updatePoi(trip.id, poi.id, {
                    photoUrl: fresh.photoUrl || poi.photoUrl || null,
                    photos: fresh.photos?.length ? fresh.photos : (poi.photos || []),
                    placeId: poi.placeId || fresh.placeId || null,
                    rating: poi.rating ?? fresh.rating ?? null,
                    userRatingsTotal: poi.userRatingsTotal ?? fresh.userRatingsTotal ?? null,
                    address: poi.address || fresh.address || '',
                    website: poi.website || fresh.website || null,
                    phoneNumber: poi.phoneNumber || fresh.phoneNumber || null,
                    openingHours: poi.openingHours || fresh.openingHours || null,
                    photoTried: true,
                });
            } else {
                store.updatePoi(trip.id, poi.id, { photoTried: true });
            }
        } catch {
            // Sin resultado o API caída: se queda con el placeholder y no reintentamos en bucle.
            store.updatePoi(trip.id, poi.id, { photoTried: true });
        }
    }, [apiIsLoaded, store, trip?.id, trip?.destinationLat, trip?.destinationLng]);

    // Pase en segundo plano: recorre los lugares sin foto de uno en uno (respetando
    // los límites de la API) y les pone la foto de Google. Un flag evita solaparse.
    useEffect(() => {
        if (!apiIsLoaded || !trip || enrichRunning.current) return;
        const pending = trip.pois.filter(p =>
            !p.photoUrl && !p.photoTried && !p.descartado && !enrichingPhotos.current.has(p.id));
        if (pending.length === 0) return;
        enrichRunning.current = true;
        let cancelled = false;
        (async () => {
            for (const poi of pending) {
                if (cancelled) break;
                await enrichPhoto(poi);
                await new Promise(r => setTimeout(r, 300));
            }
            enrichRunning.current = false;
        })();
        return () => { cancelled = true; enrichRunning.current = false; };
    }, [apiIsLoaded, trip?.pois, enrichPhoto, trip]);

    // Puntos ordenados de la ruta a dibujar en el mapa (inicio → paradas → fin).
    const routeStops = useMemo(() => {
        if (!routeItinerary) return [];
        const pts = [];
        if (routeItinerary.startLoc) pts.push({ lat: routeItinerary.startLoc.lat, lng: routeItinerary.startLoc.lng });
        (routeItinerary.timeline || []).forEach(s => { if (s.lat != null && s.lng != null) pts.push({ lat: s.lat, lng: s.lng }); });
        if (routeItinerary.endLoc) pts.push({ lat: routeItinerary.endLoc.lat, lng: routeItinerary.endLoc.lng });
        return pts;
    }, [routeItinerary]);

    useEffect(() => {
        if (!store.loading && !trip) navigate('/');
    }, [trip, store.loading, navigate]);

    useEffect(() => {
        if (trip?.destinationLat && trip?.destinationLng) {
            const newCenter = { lat: trip.destinationLat, lng: trip.destinationLng };
            setMapCenter(newCenter);
            // Pan the map if it's already loaded
            if (mapRef.current) {
                mapRef.current.panTo(newCenter);
            }
        }
    }, [trip?.destinationLat, trip?.destinationLng]);

    useEffect(() => {
        if (apiIsLoaded && trip && !trip.destinationLat && trip.destination) {
            const geocoder = new window.google.maps.Geocoder();
            geocoder.geocode({ address: trip.destination }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    const loc = results[0].geometry.location;
                    setMapCenter({ lat: loc.lat(), lng: loc.lng() });
                    store.updateTrip(tripId, { destinationLat: loc.lat(), destinationLng: loc.lng() });
                } else {
                    console.error("Geocoding failed: ", status);
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiIsLoaded, trip?.destination, trip?.destinationLat, tripId]);

    useEffect(() => {
        if (measureSource && measureDest && apiIsLoaded) {
            const ds = new window.google.maps.DirectionsService();
            ds.route({
                origin: { lat: measureSource.lat, lng: measureSource.lng },
                destination: { lat: measureDest.lat, lng: measureDest.lng },
                travelMode: measureMode
            }, (res, status) => {
                if (status === 'OK') {
                    const leg = res.routes[0].legs[0];
                    setMeasureResult({
                        duration: leg.duration.text,
                        distance: leg.distance.text
                    });
                } else {
                    setMeasureResult(null);
                }
            });
        } else {
            setMeasureResult(null);
        }
    }, [measureSource, measureDest, measureMode, apiIsLoaded]);

    // Al fijar/cambiar el campamento base recalculamos EN LOTE los tiempos en coche que
    // falten para esa base (barato: Distance Matrix agrupa destinos). Andando/transporte
    // se calculan bajo demanda al abrir cada lugar. Así el alojamiento es un origen dinámico.
    const drivingBaseDone = useRef(null);
    useEffect(() => {
        if (!apiIsLoaded || !trip) return;
        const base = trip.selectedAccommodation
            ? trip.accommodations.find(a => a.id === trip.selectedAccommodation)
            : trip.accommodations.find(a => a.isActive !== false);
        if (!base || base.lat == null) return;
        if (drivingBaseDone.current === base.id) return;
        drivingBaseDone.current = base.id;

        const pending = trip.pois.filter(p =>
            p.lat != null && !p.descartado && findDistance(trip, base.id, p.id)?.drivingDurationSeconds == null);
        if (pending.length === 0) return;

        let cancelled = false;
        (async () => {
            try {
                const rows = await computeDrivingMatrix(base, pending);
                if (cancelled || rows.length === 0) return;
                store.saveDistances(trip.id, rows.map(r => ({ accommodationId: base.id, poiId: r.poiId, drivingDurationSeconds: r.drivingDurationSeconds, distanceMeters: r.distanceMeters })));
            } catch { /* sin conexión o API sin habilitar: se calculará bajo demanda */ }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiIsLoaded, trip?.selectedAccommodation, trip?.accommodations, tripId]);

    // ===== COMPARISON =====
    const runComparison = useCallback(async () => {
        if (!trip || trip.accommodations.length === 0 || trip.pois.length === 0) return;

        // Lugares a comparar: nunca los descartados; opcionalmente solo los imprescindibles.
        const notDiscarded = trip.pois.filter(p => !p.descartado);
        let comparePois = weightEssentialOnly ? notDiscarded.filter(p => p.imprescindible) : notDiscarded;
        if (comparePois.length === 0) {
            return toast(
                weightEssentialOnly
                    ? 'No hay lugares marcados como imprescindibles. Marca alguno o desactiva esa opción.'
                    : 'No hay lugares que comparar.',
                'info', 5000
            );
        }
        setComparing(true);

        const service = new window.google.maps.DistanceMatrixService();
        const origins = trip.accommodations.map(a => new window.google.maps.LatLng(a.lat, a.lng));
        const destinations = comparePois.map(p => new window.google.maps.LatLng(p.lat, p.lng));

        // La Distance Matrix API limita cada petición a 25 orígenes, 25 destinos y
        // 100 elementos. Troceamos en lotes y combinamos la matriz de resultados.
        const MAX_DIM = 25, MAX_ELEMS = 100;
        const matrix = origins.map(() => new Array(destinations.length).fill(null));

        try {
            for (let oi = 0; oi < origins.length; oi += MAX_DIM) {
                const oChunk = origins.slice(oi, oi + MAX_DIM);
                const destPerReq = Math.max(1, Math.min(MAX_DIM, Math.floor(MAX_ELEMS / oChunk.length)));
                for (let di = 0; di < destinations.length; di += destPerReq) {
                    const dChunk = destinations.slice(di, di + destPerReq);
                    const response = await new Promise((resolve, reject) => {
                        service.getDistanceMatrix(
                            { origins: oChunk, destinations: dChunk, travelMode: 'DRIVING', language: 'es' },
                            (res, status) => status === 'OK' ? resolve(res) : reject(new Error(status))
                        );
                    });
                    response.rows.forEach((row, r) => row.elements.forEach((el, c) => { matrix[oi + r][di + c] = el; }));
                    await new Promise(r => setTimeout(r, 120));
                }
            }
        } catch (err) {
            setComparing(false);
            const status = err.message;
            const hint = status === 'REQUEST_DENIED' ? ' Habilita "Distance Matrix API" en Google Cloud.' : '';
            return toast(`Error al calcular distancias (${status}).${hint}`, 'error', 7000);
        }

        setComparing(false);

        const results = trip.accommodations.map((acc, i) => {
            const distances = comparePois.map((poi, j) => {
                const el = matrix[i][j];
                const ok = el && el.status === 'OK';
                return {
                    poiId: poi.id,
                    poiName: poi.name,
                    durationSec: ok ? el.duration.value : null,
                    durationText: ok ? el.duration.text : 'N/A',
                    distanceText: ok ? el.distance.text : 'N/A',
                };
            });

            const validDurations = distances.filter(d => d.durationSec !== null).map(d => d.durationSec);
            const avgDuration = validDurations.length > 0 ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length : 0;
            const maxDuration = validDurations.length > 0 ? Math.max(...validDurations) : 0;

            // Media ponderada: los imprescindibles pesan más; también la frecuencia de visita.
            let weightedSum = 0, weightTotal = 0;
            distances.forEach((d, j) => {
                if (d.durationSec !== null) {
                    const poi = comparePois[j];
                    const freq = (poi.visitFrequency || 1) * (poi.imprescindible ? 2 : 1);
                    weightedSum += d.durationSec * freq;
                    weightTotal += freq;
                }
            });
            const weightedAvg = weightTotal > 0 ? weightedSum / weightTotal : 0;

            return {
                accommodationId: acc.id,
                name: acc.name,
                photoUrl: acc.photoUrl,
                distances,
                avgDuration,
                maxDuration,
                weightedAvg,
            };
        });

        // Rank by weighted average
        results.sort((a, b) => a.weightedAvg - b.weightedAvg);
        results.forEach((r, index) => r.rank = index + 1);

        // Save distances to store
        const distanceRecords = [];
        results.forEach(r => {
            r.distances.forEach(d => {
                if (d.durationSec !== null) {
                    distanceRecords.push({
                        accommodationId: r.accommodationId,
                        poiId: d.poiId,
                        drivingDurationSeconds: d.durationSec,
                    });
                }
            });
        });
        store.saveDistances(tripId, distanceRecords);
        setComparisonResults(results);
        // La comparación vive ahora DENTRO de Alojamiento: hacemos scroll a los resultados
        // en vez de cambiar de pestaña (un único flujo, sin romper la navegación).
        setTimeout(() => comparisonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }, [trip, tripId, store, weightEssentialOnly]);

    // ===== MAP INIT =====
    const onMapLoad = useCallback((map) => {
        if (!mapRef.current) {
            mapRef.current = map;
            // Solo hacer panTo en la primera carga inicial del mapa
            if (mapCenter) map.panTo(mapCenter);
        }
    }, [mapCenter]);

    if (store.loading) return <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontWeight: 800, color: 'var(--color-primary)' }}>Cargando viaje...</div>;
    if (!trip) return null;

    // Base activa: el campamento base fijado, o el primer alojamiento activo.
    const activeBase = trip.selectedAccommodation
        ? trip.accommodations.find(a => a.id === trip.selectedAccommodation)
        : trip.accommodations.find(a => a.isActive !== false);

    // Distancia en km (línea recta) de un lugar a la base activa. Sin API: haversine.
    const distanceToBase = (poi) =>
        activeBase && poi.lat != null ? haversineMeters(activeBase, poi) : Infinity;

    const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const q = normalize(poiSearch.trim());

    const filteredPois = trip.pois
        .filter(p => showDescartados ? true : !p.descartado)
        .filter(p => activeFilter === 'all' ? true : p.category === activeFilter)
        .filter(p => onlyImprescindible ? p.imprescindible : true)
        .filter(p => hideVisitados ? !p.yaVisitado : true)
        .filter(p => !q || normalize(p.name).includes(q) || normalize(p.municipio).includes(q) || normalize(p.notas).includes(q))
        .sort((a, b) => {
            if (sortBy === 'distance') return distanceToBase(a) - distanceToBase(b);
            if (sortBy === 'duration') return (b.duracionEstimadaMin || 0) - (a.duracionEstimadaMin || 0);
            return a.name.localeCompare(b.name, 'es');
        });

    // ===== PLACES SEARCH =====
    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        if (!apiIsLoaded) return toast('Google Maps aún cargando. Espera un momento.', 'info');

        const locationBias = trip.destinationLat && trip.destinationLng
            ? { lat: trip.destinationLat, lng: trip.destinationLng }
            : null;

        setSearchLoading(true);
        try {
            const results = await searchPlacesByText(searchQuery, { locationBias });
            setSearchResults(results);
            if (results.length === 0) toast('Sin resultados para esa búsqueda.', 'info');
        } catch (err) {
            console.error('Places search failed:', err);
            setSearchResults([]);
            toast('No se pudo buscar. Revisa la conexión o la API de Google Maps.', 'error');
        } finally {
            setSearchLoading(false);
        }
    };

    const handleAddSearchResult = (place, category) => {
        // `place` ya viene normalizado desde el adaptador de Places. Si no se pasa categoría
        // explícita, la deducimos de los `types` de Google + el nombre. Si el usuario la elige
        // a mano, la fijamos (categoryLocked) para que la reclasificación no la toque.
        const resolved = category || guessCategory({ name: place.name, types: place.types });
        store.addPoi(tripId, {
            name: place.name,
            placeId: place.placeId,
            category: resolved,
            categoryLocked: !!category,
            lat: place.lat,
            lng: place.lng,
            address: place.address || '',
            rating: place.rating || null,
            userRatingsTotal: place.userRatingsTotal || null,
            photoUrl: place.photoUrl || null,
            photos: place.photos || [],
            openingHours: place.openingHours || null,
            types: place.types || [],
            website: place.website || null,
            phoneNumber: place.phoneNumber || null,
            priceLevel: place.priceLevel ?? null,
        });
        toast(`"${place.name}" añadido.`, 'success');
        setSearchResults(prev => prev.filter(r => r.placeId !== place.placeId));
    };

    const handleAddAccResult = (place) => {
        store.addAccommodation(tripId, {
            name: place.name,
            address: place.address || '',
            lat: place.lat,
            lng: place.lng,
            placeId: place.placeId,
            photoUrl: place.photoUrl || null,
        });
        toast(`"${place.name}" añadido.`, 'success');
        setSearchResults(prev => prev.filter(r => r.placeId !== place.placeId));
    };



    const handleSelectWinner = (accId) => {
        store.selectAccommodation(tripId, accId);
    };

    // Días-semilla del itinerario (día + lista de paradas). El motor rico los expande luego.
    const seedDays = (trip?.itineraries || []).filter(it => it.seed);

    // Añade un lugar a un día (semilla). dayId === 'new' crea un día nuevo.
    const addPoiToDay = (poi, dayId) => {
        const list = trip.itineraries || [];
        let updated;
        if (dayId === 'new') {
            const maxDia = list.reduce((m, it) => Math.max(m, it.dia || 0), 0);
            const dia = maxDia + 1;
            updated = [...list, {
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
                seed: true, dia, fecha: null,
                baseId: trip.selectedAccommodation || null,
                paradas: [poi.id], title: `Día ${dia}`, notas: '',
            }];
            toast(`"${poi.name}" añadido al Día ${dia}.`, 'success');
        } else {
            updated = list.map(it => {
                if (it.id !== dayId) return it;
                if ((it.paradas || []).includes(poi.id)) { toast('Ese lugar ya estaba en el día.', 'info'); return it; }
                toast(`"${poi.name}" añadido a ${it.title || 'el día'}.`, 'success');
                return { ...it, paradas: [...(it.paradas || []), poi.id] };
            });
        }
        store.updateTrip(tripId, { itineraries: updated });
        setDayPickerPoi(null);
    };

    // Centra el mapa en un lugar y abre su marcador (usado desde la Guía).
    const showPoiOnMap = (poi) => {
        if (poi.lat == null) return;
        setRouteItinerary(null);
        setSelectedMarker(poi);
        setMapCenter({ lat: poi.lat, lng: poi.lng });
        if (mapRef.current) mapRef.current.panTo({ lat: poi.lat, lng: poi.lng });
        setTab('map');
    };

    // Exporta el viaje completo al JSON del contrato y lo descarga.
    const handleExport = () => {
        const json = exportFromInternal(trip);
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const slug = (trip.destination || trip.name || 'viaje').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        a.href = url;
        a.download = `viaje-${slug || 'export'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('Viaje exportado a JSON.', 'success');
    };



    // Resultados de la comparación de alojamientos (se muestran DENTRO de Alojamiento).
    const renderComparison = () => (
        <div className="stagger">
            {/* Winner */}
            {comparisonResults.length > 0 && (
                <div className="winner-card card animate-fade-in-up">
                    <div className="winner-header">
                        <span className="badge badge-gold">🥇 Recomendado</span>
                        <h2 className="text-title" style={{ marginTop: '8px' }}>{comparisonResults[0].name}</h2>
                    </div>
                    <div className="winner-savings">
                        {comparisonResults.length > 1 && (
                            <p className="text-hero" style={{ color: 'var(--color-primary)', fontSize: '22px' }}>
                                Ahorrarás {formatDuration(
                                    (comparisonResults[comparisonResults.length - 1].weightedAvg - comparisonResults[0].weightedAvg)
                                )} por trayecto
                            </p>
                        )}
                    </div>
                    <div className="winner-metrics">
                        <div className="metric-box">
                            <span className="text-small text-tertiary">Media</span>
                            <span className="metric-value">{formatDuration(comparisonResults[0].avgDuration)}</span>
                        </div>
                        <div className="metric-box">
                            <span className="text-small text-tertiary">Máximo</span>
                            <span className="metric-value">{formatDuration(comparisonResults[0].maxDuration)}</span>
                        </div>
                        <div className="metric-box">
                            <span className="text-small text-tertiary">Ponderada</span>
                            <span className="metric-value">{formatDuration(comparisonResults[0].weightedAvg)}</span>
                        </div>
                    </div>

                    {/* Breakdown */}
                    <div className="winner-breakdown">
                        <p className="text-caption text-secondary" style={{ marginBottom: '8px' }}>Tiempos a cada lugar:</p>
                        {comparisonResults[0].distances.map(d => (
                            <div key={d.poiId} className="breakdown-row">
                                <span className="text-caption truncate" style={{ flex: 1 }}>{d.poiName}</span>
                                <span className="text-caption" style={{ fontWeight: 700 }}>{d.durationText}</span>
                            </div>
                        ))}
                    </div>

                    <button
                        className="btn btn-accent btn-full"
                        style={{ marginTop: 'var(--space-md)' }}
                        onClick={() => handleSelectWinner(comparisonResults[0].accommodationId)}
                    >
                        <CheckCircle2 size={18} />
                        {trip.selectedAccommodation === comparisonResults[0].accommodationId
                            ? '✅ Campamento Base Fijado'
                            : 'Fijar Campamento Base'
                        }
                    </button>
                </div>
            )}

            {/* Other Candidates */}
            {comparisonResults.slice(1).map(result => (
                <div key={result.accommodationId} className="card compare-card animate-fade-in-up">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                        <div>
                            <span className="badge badge-primary" style={{ marginBottom: '6px' }}>#{result.rank}</span>
                            <h3 style={{ fontWeight: 700, fontSize: '15px' }}>{result.name}</h3>
                        </div>
                        <span className="text-caption" style={{ color: 'var(--color-danger)', fontWeight: 700 }}>
                            +{formatDuration(result.weightedAvg - comparisonResults[0].weightedAvg)}/trayecto
                        </span>
                    </div>
                    <div className="compare-metrics" style={{ marginTop: '12px' }}>
                        <span className="text-caption text-secondary">Media: {formatDuration(result.avgDuration)}</span>
                        <span className="text-caption text-secondary">Máx: {formatDuration(result.maxDuration)}</span>
                    </div>

                    {/* Breakdown */}
                    <div className="winner-breakdown" style={{ marginTop: 'var(--space-md)' }}>
                        <p className="text-caption text-secondary" style={{ marginBottom: '8px' }}>Tiempos a cada lugar:</p>
                        {result.distances.map(d => (
                            <div key={d.poiId} className="breakdown-row" style={{ padding: '4px 0' }}>
                                <span className="text-caption truncate" style={{ flex: 1 }}>{d.poiName}</span>
                                <span className="text-caption" style={{ fontWeight: 700 }}>{d.durationText}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );

    const TABS = [
        { id: 'places', label: 'Lugares', icon: List },
        { id: 'map', label: 'Mapa', icon: MapIcon },
        { id: 'hotels', label: 'Alojamiento', icon: Hotel },
        { id: 'itinerary', label: 'Itinerario', icon: Navigation },
        { id: 'guide', label: 'Guía', icon: BookOpen },
    ];

    return (
        <div className="page-content trip-view">
            <PageHeader
                title={trip.name}
                subtitle={trip.destination}
                onBack={() => navigate('/')}
                rightAction={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                            onClick={handleExport}
                            title="Exportar el viaje a un archivo JSON"
                            aria-label="Exportar viaje a JSON"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-full)', color: 'var(--color-primary)', border: '1px solid var(--color-primary-light)' }}
                        >
                            <Download size={16} />
                        </button>
                        <button
                            onClick={() => setShowShareModal(true)}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 'var(--radius-full)', color: 'var(--color-primary)', fontWeight: 600, fontSize: '14px', border: '1px solid var(--color-primary-light)' }}
                        >
                            <UserPlus size={16} /> Compartir
                        </button>
                    </div>
                }
            />

            {/* Tabs */}
            <div className="trip-tabs">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        className={`trip-tab ${tab === t.id ? 'active' : ''}`}
                        onClick={() => setTab(t.id)}
                        id={`tab-${t.id}`}
                    >
                        <t.icon size={16} />
                        {t.label}
                        {t.id === 'places' && trip.pois.length > 0 && (
                            <span className="tab-badge">{trip.pois.length}</span>
                        )}
                        {t.id === 'hotels' && trip.accommodations.length > 0 && (
                            <span className="tab-badge">{trip.accommodations.length}</span>
                        )}
                        {t.id === 'guide' && (trip.seccionesGuia?.length > 0) && (
                            <span className="tab-badge">{trip.seccionesGuia.length}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* ===== TAB: PLACES ===== */}
            {tab === 'places' && (
                <div className="tab-content">
                    {/* Buscador por texto */}
                    <div style={{ padding: '0 var(--space-lg)', marginBottom: 'var(--space-sm)' }}>
                        <div className="input-group">
                            <div className="input-icon"><Search size={18} /></div>
                            <input
                                className="input-field"
                                value={poiSearch}
                                onChange={e => setPoiSearch(e.target.value)}
                                placeholder="Buscar por nombre, municipio o notas..."
                            />
                            {poiSearch && (
                                <button onClick={() => setPoiSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
                            )}
                        </div>
                    </div>

                    {/* Filtros por categoría */}
                    <div className="chip-row" style={{ padding: '0 var(--space-lg)', marginBottom: 'var(--space-sm)' }}>
                        <button className={`chip ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => setActiveFilter('all')}>
                            📍 Todo
                        </button>
                        {CATEGORIES.map(c => (
                            <button key={c.id} className={`chip ${activeFilter === c.id ? 'active' : ''}`} onClick={() => setActiveFilter(c.id)}>
                                {c.emoji} {c.label}
                            </button>
                        ))}
                    </div>

                    {/* Filtros de estado + orden */}
                    <div className="chip-row" style={{ padding: '0 var(--space-lg)', marginBottom: 'var(--space-md)', alignItems: 'center' }}>
                        <button className={`chip ${onlyImprescindible ? 'active' : ''}`} onClick={() => setOnlyImprescindible(v => !v)}>
                            ❤️ Imprescindibles
                        </button>
                        <button className={`chip ${hideVisitados ? 'active' : ''}`} onClick={() => setHideVisitados(v => !v)}>
                            ✅ Ocultar visitados
                        </button>
                        <button className={`chip ${showDescartados ? 'active' : ''}`} onClick={() => setShowDescartados(v => !v)}>
                            🚫 Ver descartados
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
                            <span className="text-caption text-tertiary">Orden:</span>
                            <select
                                value={sortBy}
                                onChange={e => setSortBy(e.target.value)}
                                style={{ padding: '6px 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border-color)', fontSize: 12, background: 'var(--bg-primary)', cursor: 'pointer', fontWeight: 600 }}
                            >
                                <option value="alpha">Alfabético</option>
                                <option value="distance" disabled={!activeBase}>Distancia a la base</option>
                                <option value="duration">Duración</option>
                            </select>
                        </div>
                    </div>

                    {/* POI List */}
                    <div className="poi-list stagger" style={{ padding: '0 var(--space-lg)' }}>
                        {filteredPois.map(poi => (
                            <div key={poi.id} className="poi-item card animate-fade-in-up" style={{ opacity: poi.descartado ? 0.55 : 1 }}>
                                <button
                                    type="button"
                                    title={poi.isActive !== false ? 'Quitar del viaje' : 'Incluir en el viaje'}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        // Reactivar un lugar descartado también lo saca de "descartado" (coherencia de estados).
                                        if (poi.isActive === false && poi.descartado) {
                                            store.updatePoi(tripId, poi.id, { isActive: true, descartado: false });
                                        } else {
                                            store.togglePoiActive(tripId, poi.id);
                                        }
                                    }}
                                    style={{
                                        width: '44px', height: '44px', flexShrink: 0,
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        background: 'transparent', border: 'none', WebkitTapHighlightColor: 'transparent'
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                                            border: poi.isActive !== false ? 'none' : '2px solid var(--text-tertiary)',
                                            background: poi.isActive !== false ? 'var(--color-primary)' : 'transparent',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: 'white'
                                        }}
                                    >
                                        {poi.isActive !== false && <CheckCircle2 size={16} strokeWidth={3} />}
                                    </div>
                                </button>

                                <div
                                    style={{ display: 'flex', gap: '12px', flex: 1, minWidth: 0, alignItems: 'center', cursor: 'pointer' }}
                                    onClick={() => setPoiDetail(poi)}
                                >
                                    <div className="poi-img">
                                        <img
                                            src={poi.photoUrl || getPlaceholderImage(poi.name)}
                                            alt={poi.name}
                                            onError={(e) => { if (!e.currentTarget.dataset.fb) { e.currentTarget.dataset.fb = '1'; e.currentTarget.src = getPlaceholderImage(poi.name); repairPhoto(poi); } }}
                                        />
                                    </div>
                                    <div className="poi-info">
                                        <h3 className="text-body" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {poi.imprescindible && <Heart size={13} fill="var(--color-primary)" color="var(--color-primary)" style={{ flexShrink: 0 }} />}
                                            <span className="truncate">{poi.name}</span>
                                        </h3>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                                            <span className="cat-dot" style={{ background: CATEGORY_MAP[poi.category]?.color || '#6b7280' }}></span>
                                            <span className="text-caption text-secondary">{CATEGORY_MAP[poi.category]?.label || 'Otro'}</span>
                                            {poi.rating && (
                                                <span className="text-caption" style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#f5a623' }}>
                                                    <Star size={12} fill="#f5a623" /> {poi.rating}
                                                </span>
                                            )}
                                            {poi.yaVisitado && (
                                                <span className="text-caption" style={{ display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--color-accent)', fontWeight: 700 }}>
                                                    <CheckCircle2 size={12} /> Visitado
                                                </span>
                                            )}
                                        </div>
                                        {(activeBase && distanceToBase(poi) !== Infinity || poi.duracionEstimadaMin > 0) && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                                                {activeBase && distanceToBase(poi) !== Infinity && (
                                                    <span className="text-caption text-tertiary" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                        <Navigation size={11} /> {(distanceToBase(poi) / 1000).toFixed(distanceToBase(poi) < 10000 ? 1 : 0)} km
                                                    </span>
                                                )}
                                                {poi.duracionEstimadaMin > 0 && (
                                                    <span className="text-caption text-tertiary" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                        <Clock size={11} /> {formatDuration(poi.duracionEstimadaMin * 60)}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <button type="button" className="poi-delete" onClick={(e) => { e.stopPropagation(); store.removePoi(tripId, poi.id); }}>
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {filteredPois.length === 0 && (
                        <div className="empty-state">
                            <Search size={48} />
                            {trip.pois.length === 0 ? (
                                <p className="text-body text-tertiary">Aún no hay lugares. Importa tu investigación o añade el primero con los botones de abajo.</p>
                            ) : (
                                <p className="text-body text-tertiary">Ningún lugar coincide con los filtros. Prueba a limpiarlos.</p>
                            )}
                        </div>
                    )}

                    {(!showAddPoi && !showAddAcc && !poiDetail) && (
                        <div style={{
                            position: 'fixed',
                            bottom: 'calc(var(--nav-height) + 16px)',
                            left: '0',
                            right: '0',
                            margin: '0 auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            width: 'calc(100% - 48px)',
                            maxWidth: '432px',
                            zIndex: 50,
                        }}>
                            <button
                                className="btn btn-primary"
                                style={{ width: '100%', borderRadius: 'var(--radius-full)' }}
                                onClick={() => { setShowAddPoi(true); setSearchResults([]); setSearchQuery(''); }}
                                id="add-poi-btn"
                            >
                                <Plus size={18} /> Añadir Lugar
                            </button>
                            <button
                                className="btn btn-outline"
                                style={{ width: '100%', borderRadius: 'var(--radius-full)', background: 'rgba(255,255,255,0.95)' }}
                                onClick={() => setShowImportTrip(true)}
                            >
                                📥 Importar investigación (JSON)
                            </button>
                            <button
                                className="text-caption text-secondary"
                                style={{ width: '100%', padding: '4px', background: 'transparent' }}
                                onClick={() => setShowBulkImport(true)}
                            >
                                o pegar una lista de lugares en texto
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ===== TAB: MAP ===== */}
            {tab === 'map' && (
                <div className="tab-content map-tab">
                    <Map
                        defaultCenter={mapCenter}
                        defaultZoom={trip.pois.length > 0 ? 10 : 9}
                        mapId="travel-map"
                        gestureHandling="greedy"
                        disableDefaultUI={false}
                        onTilesLoaded={(e) => onMapLoad(e.map)}
                        style={{ width: '100%', height: '100%' }}
                    >
                        {!routeItinerary && trip.pois.filter(p => p.isActive !== false && !p.descartado).map(poi => (
                            <AdvancedMarker
                                key={poi.id}
                                position={{ lat: poi.lat, lng: poi.lng }}
                                title={poi.name}
                                onClick={() => setSelectedMarker(poi)}
                            >
                                <div className="marker-custom" style={{ background: CATEGORY_MAP[poi.category]?.color || '#6b7280' }}>
                                    {CATEGORY_MAP[poi.category]?.emoji || '📍'}
                                </div>
                            </AdvancedMarker>
                        ))}

                        {!routeItinerary && trip.accommodations.filter(a => a.isActive !== false).map(acc => (
                            <AdvancedMarker
                                key={acc.id}
                                position={{ lat: acc.lat, lng: acc.lng }}
                                title={acc.name}
                                onClick={() => setSelectedMarker(acc)}
                            >
                                <div className="marker-custom marker-acc" style={{
                                    background: trip.selectedAccommodation === acc.id ? '#f5a623' : '#ef4444'
                                }}>
                                    🏨
                                </div>
                            </AdvancedMarker>
                        ))}

                        {/* Ruta del itinerario seleccionado (línea por carretera + paradas numeradas) */}
                        {routeItinerary && routeStops.length >= 2 && (
                            <RouteOverlay stops={routeStops} color="#256af4" />
                        )}

                        {/* Ruta de la medida Desde/Hasta: dibuja el recorrido real entre A y B. */}
                        {measureSource && measureDest && measureSource.lat != null && measureDest.lat != null && (
                            <RouteOverlay
                                origin={{ lat: measureSource.lat, lng: measureSource.lng }}
                                destination={{ lat: measureDest.lat, lng: measureDest.lng }}
                                mode={measureMode}
                                color="#f5a623"
                                preserveViewport
                            />
                        )}
                        {routeItinerary?.startLoc && (
                            <AdvancedMarker position={{ lat: routeItinerary.startLoc.lat, lng: routeItinerary.startLoc.lng }} title="Inicio">
                                <div className="marker-custom" style={{ background: '#10b981' }}>🚗</div>
                            </AdvancedMarker>
                        )}
                        {routeItinerary && (() => {
                            let poiNum = 0;
                            return (routeItinerary.timeline || [])
                                .filter(s => s.lat != null && s.lng != null)
                                .map((s, idx) => {
                                    if (s.type === 'poi') {
                                        poiNum += 1;
                                        const num = poiNum;
                                        return (
                                            <AdvancedMarker
                                                key={`r-${idx}`}
                                                position={{ lat: s.lat, lng: s.lng }}
                                                title={s.name}
                                                onClick={() => setSelectedMarker(trip.pois.find(p => p.id === s.poiId) || s)}
                                            >
                                                <div className="marker-custom" style={{ background: 'var(--color-primary)' }}>{num}</div>
                                            </AdvancedMarker>
                                        );
                                    }
                                    return (
                                        <AdvancedMarker key={`r-${idx}`} position={{ lat: s.lat, lng: s.lng }} title={s.name}>
                                            <div className="marker-custom" style={{ background: '#f97316' }}>🍴</div>
                                        </AdvancedMarker>
                                    );
                                });
                        })()}
                        {routeItinerary?.endLoc && (
                            <AdvancedMarker position={{ lat: routeItinerary.endLoc.lat, lng: routeItinerary.endLoc.lng }} title="Fin">
                                <div className="marker-custom" style={{ background: '#111827' }}>🏁</div>
                            </AdvancedMarker>
                        )}

                        {/* Info Window */}
                        {selectedMarker && (
                            <InfoWindow
                                position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
                                onCloseClick={() => setSelectedMarker(null)}
                            >
                                <div style={{ maxWidth: '200px', padding: '2px' }}>
                                    {/* Cabecera compacta con miniatura: no agranda el menú. */}
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <img
                                            src={selectedMarker.photoUrl || getPlaceholderImage(selectedMarker.name)}
                                            alt=""
                                            onError={e => { e.currentTarget.src = getPlaceholderImage(selectedMarker.name); }}
                                            style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                                        />
                                        <div style={{ minWidth: 0 }}>
                                            <h3 style={{ fontSize: '13px', fontWeight: 800, marginBottom: '2px', lineHeight: 1.2 }}>{selectedMarker.name}</h3>
                                            {selectedMarker.category && (
                                                <span className="text-secondary" style={{ fontSize: '10px' }}>{CATEGORY_MAP[selectedMarker.category]?.label}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '11px', width: '100%', borderRadius: '4px' }} onClick={() => {
                                            if (selectedMarker.placeId && !selectedMarker.category) setAccDetail(selectedMarker);
                                            else setPoiDetail(selectedMarker);
                                        }}>Ver Detalles</button>
                                        {selectedMarker.category && (
                                            <button className="btn btn-accent" style={{ padding: '4px 8px', fontSize: '11px', width: '100%', borderRadius: '4px' }} onClick={() => { setDayPickerPoi(selectedMarker); setSelectedMarker(null); }}>
                                                + Añadir a un día
                                            </button>
                                        )}
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button className="btn btn-outline" style={{ padding: '4px 6px', fontSize: '10px', flex: 1, borderRadius: '4px' }} onClick={() => setMeasureSource(selectedMarker)}>Desde aquí</button>
                                            <button className="btn btn-outline" style={{ padding: '4px 6px', fontSize: '10px', flex: 1, borderRadius: '4px' }} onClick={() => setMeasureDest(selectedMarker)}>Hasta aquí</button>
                                        </div>
                                    </div>
                                </div>
                            </InfoWindow>
                        )}
                    </Map>

                    {/* Banner de la ruta del itinerario */}
                    {routeItinerary && (
                        <div className="card animate-fade-in-up" style={{
                            position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)',
                            zIndex: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px',
                            maxWidth: 'calc(100% - 24px)', boxShadow: '0 8px 30px rgba(0,0,0,0.15)'
                        }}>
                            <Navigation size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                            <span style={{ fontWeight: 700, fontSize: '13px' }} className="truncate">Ruta: {routeItinerary.title}</span>
                            <button onClick={() => setRouteItinerary(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', flexShrink: 0 }}><X size={16} /></button>
                        </div>
                    )}

                    {/* Measure Overlay */}
                    {(measureSource || measureDest) && (
                        <div className="card animate-fade-in-up" style={{
                            position: 'absolute', top: '12px', right: '12px', left: 'auto', transform: 'none',
                            zIndex: 10, padding: '8px', width: '200px', display: 'flex', flexDirection: 'column', gap: '4px',
                            boxShadow: '0 8px 30px rgba(0,0,0,0.15)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0px' }}>
                                <span style={{ fontWeight: 800, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><MapIcon size={12} color="var(--color-primary)" /> Medida</span>
                                <button onClick={() => { setMeasureSource(null); setMeasureDest(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={14} /></button>
                            </div>
                            <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px', background: 'var(--bg-tertiary)', padding: '6px', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><div className="cat-dot" style={{ background: '#3b82f6', width: '5px', height: '5px' }} /> <span className="truncate"><strong>A:</strong> {measureSource ? measureSource.name : '...'}</span></div>
                                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><div className="cat-dot" style={{ background: '#ef4444', width: '5px', height: '5px' }} /> <span className="truncate"><strong>B:</strong> {measureDest ? measureDest.name : '...'}</span></div>
                            </div>
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                                <select value={measureMode} onChange={e => setMeasureMode(e.target.value)} style={{ padding: '2px 4px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '10px', cursor: 'pointer', background: 'var(--bg-primary)' }}>
                                    <option value="DRIVING">🚗 Coche</option>
                                    <option value="WALKING">🚶 A pie</option>
                                    <option value="TRANSIT">🚌 TP</option>
                                    <option value="BICYCLING">🚲 Bici</option>
                                </select>
                                {measureResult ? (
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 800, color: 'var(--color-primary)', fontSize: '12px', lineHeight: 1 }}>{measureResult.duration}</div>
                                        <div className="text-caption text-secondary" style={{ fontSize: '9px', lineHeight: 1, marginTop: '2px' }}>{measureResult.distance}</div>
                                    </div>
                                ) : (measureSource && measureDest) ? (
                                    <span className="text-caption text-secondary" style={{ fontSize: '10px' }}>Calc...</span>
                                ) : null}
                            </div>
                        </div>
                    )}


                </div>
            )}

            {/* ===== TAB: HOTELS ===== */}
            {tab === 'hotels' && (
                <div className="tab-content" style={{ padding: 'var(--space-lg) var(--space-lg) calc(var(--nav-height) + 120px) var(--space-lg)' }}>
                    <div className="animate-fade-in-up">
                        <h2 className="text-subtitle" style={{ marginBottom: '4px' }}>¿Dónde vas a dormir?</h2>
                        <p className="text-body text-secondary" style={{ marginBottom: 'var(--space-lg)' }}>
                            Añade alojamientos para comparar cuál tiene mejor ubicación.
                        </p>
                    </div>

                    {trip.accommodations.map(acc => (
                        <div key={acc.id} className="card acc-card animate-fade-in-up">
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); store.toggleAccommodationActive(tripId, acc.id); }}
                                style={{
                                    width: '44px', height: '44px', flexShrink: 0,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'transparent', border: 'none', WebkitTapHighlightColor: 'transparent'
                                }}
                            >
                                <div
                                    style={{
                                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                                        border: acc.isActive !== false ? 'none' : '2px solid var(--text-tertiary)',
                                        background: acc.isActive !== false ? 'var(--color-primary)' : 'transparent',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: 'white'
                                    }}
                                >
                                    {acc.isActive !== false && <CheckCircle2 size={16} strokeWidth={3} />}
                                </div>
                            </button>

                            <div
                                style={{ display: 'flex', gap: '12px', flex: 1, minWidth: 0, alignItems: 'center', cursor: 'pointer' }}
                                onClick={() => setAccDetail(acc)}
                            >
                                <div className="acc-card-img">
                                    <img src={acc.photoUrl || getPlaceholderImage(acc.name)} alt={acc.name} />
                                    {trip.selectedAccommodation === acc.id && (
                                        <div className="acc-winner-badge">
                                            <Trophy size={12} /> Campamento Base
                                        </div>
                                    )}
                                </div>
                                <div className="acc-card-info">
                                    <h3 style={{ fontWeight: 700, fontSize: '15px' }}>{acc.name}</h3>
                                    <p className="text-caption text-secondary truncate">{acc.address}</p>
                                </div>
                            </div>

                            <button type="button" className="poi-delete" onClick={(e) => { e.stopPropagation(); store.removeAccommodation(tripId, acc.id); }}>
                                <Trash2 size={18} />
                            </button>
                        </div>
                    ))}

                    {trip.accommodations.length === 0 && (
                        <div className="empty-state" style={{ marginTop: 'var(--space-xl)' }}>
                            <Hotel size={48} />
                            <p className="text-body text-tertiary">
                                Añade uno o varios alojamientos candidatos y te diré cuál queda mejor situado. También llegan al importar tu investigación.
                            </p>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
                        <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setShowAddAcc(true); setSearchResults([]); setSearchQuery(''); }}>
                            <Plus size={16} /> Añadir Alojamiento
                        </button>
                    </div>

                    {trip.accommodations.length >= 1 && trip.pois.length >= 1 && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'var(--space-lg)', padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={weightEssentialOnly}
                                onChange={e => setWeightEssentialOnly(e.target.checked)}
                                style={{ width: 20, height: 20, accentColor: 'var(--color-primary)', flexShrink: 0 }}
                            />
                            <span>
                                <span style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <Heart size={14} fill="var(--color-primary)" color="var(--color-primary)" /> Comparar solo con imprescindibles
                                </span>
                                <span className="text-caption text-secondary">Ignora los sitios lejanos que no piensas visitar.</span>
                            </span>
                        </label>
                    )}

                    {trip.accommodations.length >= 1 && trip.pois.length >= 1 && (
                        <button
                            className="btn btn-accent btn-full"
                            style={{ marginTop: 'var(--space-md)' }}
                            onClick={runComparison}
                            disabled={comparing}
                            id="compare-btn"
                        >
                            {comparing ? (
                                <>⏳ Calculando rutas...</>
                            ) : (
                                <>✨ Comparar Ubicaciones</>
                            )}
                        </button>
                    )}

                    {/* Resultados de la comparación, integrados en el mismo flujo. */}
                    {comparisonResults && (
                        <div ref={comparisonRef} style={{ marginTop: 'var(--space-xl)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-md)' }}>
                                <BarChart3 size={18} style={{ color: 'var(--color-primary)' }} />
                                <h3 className="text-subtitle">Comparación de ubicaciones</h3>
                            </div>
                            {renderComparison()}
                        </div>
                    )}
                </div>
            )}

            {/* ===== TAB: ITINERARY ===== */}
            {tab === 'itinerary' && (
                <div className="tab-content" style={{ padding: 'var(--space-lg) var(--space-lg) calc(var(--nav-height) + 120px) var(--space-lg)' }}>
                    <ItineraryTab trip={trip} store={store} onShowOnMap={(it) => { setRouteItinerary(it); setTab('map'); }} />
                </div>
            )}

            {/* ===== TAB: GUÍA ===== */}
            {tab === 'guide' && (
                <div className="tab-content">
                    <GuideTab
                        trip={trip}
                        onOpenPoi={(poi) => setPoiDetail(poi)}
                        onShowOnMap={showPoiOnMap}
                        onAddToDay={(poi) => setDayPickerPoi(poi)}
                    />
                </div>
            )}

            {/* ===== MODAL: SHARE TRIP ===== */}
            {showShareModal && (
                <ShareTripModal trip={trip} store={store} onClose={() => setShowShareModal(false)} />
            )}

            {/* ===== MODAL: ADD POI ===== */}
            {showAddPoi && (
                <div className="modal-overlay animate-fade-in" onClick={() => setShowAddPoi(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="text-subtitle">Buscar Lugar</h2>
                            <button onClick={() => setShowAddPoi(false)} className="modal-close"><X size={22} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-md)' }}>
                            <div className="input-group" style={{ flex: 1 }}>
                                <div className="input-icon"><Search size={18} /></div>
                                <input
                                    className="input-field"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                    placeholder="Teide, Siam Park, restaurante..."
                                    autoFocus
                                    id="search-poi-input"
                                />
                            </div>
                            <button className="btn btn-primary" style={{ padding: '12px 16px' }} onClick={handleSearch}>
                                <Search size={18} />
                            </button>
                        </div>
                        <div className="search-results">
                            {searchLoading && (
                                <p className="text-caption text-tertiary" style={{ padding: '16px', textAlign: 'center' }}>
                                    Buscando lugares...
                                </p>
                            )}
                            {searchResults.map(place => (
                                <div key={place.placeId} className="search-result-item">
                                    <div className="sr-main">
                                        <div className="sr-img">
                                            <img src={place.photoUrl || getPlaceholderImage(place.name)} alt={place.name} />
                                        </div>
                                        <div className="sr-info">
                                            <h4 className="truncate-2-lines" style={{ fontWeight: 700, fontSize: '14px', lineHeight: '1.2', marginBottom: '4px' }}>{place.name}</h4>
                                            <p className="text-caption text-secondary truncate">{place.address}</p>
                                            {place.rating && (
                                                <span className="text-caption" style={{ color: '#f5a623' }}>⭐ {place.rating}</span>
                                            )}
                                        </div>
                                    </div>
                                    {(() => {
                                        const guessed = CATEGORY_MAP[guessCategory({ name: place.name, types: place.types })] || CATEGORY_MAP.other;
                                        return (
                                            <>
                                                <button
                                                    className="btn btn-primary"
                                                    style={{ marginTop: '8px', marginLeft: '60px', width: 'calc(100% - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '13px', padding: '8px 12px' }}
                                                    onClick={() => handleAddSearchResult(place)}
                                                >
                                                    <Plus size={15} /> Añadir como {guessed.emoji} {guessed.label}
                                                </button>
                                                <div className="sr-actions" style={{ display: 'flex', gap: '8px', paddingLeft: '60px', marginTop: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                                                    {CATEGORIES.map(c => (
                                                        <button
                                                            key={c.id}
                                                            className="sr-cat-btn"
                                                            title={`Añadir como ${c.label}`}
                                                            onClick={() => handleAddSearchResult(place, c.id)}
                                                            style={{ flexShrink: 0 }}
                                                        >
                                                            {c.emoji}
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            ))}
                            {!searchLoading && searchResults.length === 0 && searchQuery && (
                                <p className="text-caption text-tertiary" style={{ padding: '16px', textAlign: 'center' }}>
                                    Busca un lugar y selecciona su categoría para añadirlo
                                </p>
                            )}
                        </div>

                    </div>
                </div>
            )}

            {/* ===== MODAL: ADD ACCOMMODATION ===== */}
            {showAddAcc && (
                <div className="modal-overlay animate-fade-in" onClick={() => setShowAddAcc(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="text-subtitle">Buscar Alojamiento</h2>
                            <button onClick={() => setShowAddAcc(false)} className="modal-close"><X size={22} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: 'var(--space-md)' }}>
                            <div className="input-group" style={{ flex: 1 }}>
                                <div className="input-icon"><Search size={18} /></div>
                                <input
                                    className="input-field"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                    placeholder="Hotel, apartamento, dirección..."
                                    autoFocus
                                    id="search-acc-input"
                                />
                            </div>
                            <button className="btn btn-primary" style={{ padding: '12px 16px' }} onClick={handleSearch}>
                                <Search size={18} />
                            </button>
                        </div>
                        <div className="search-results">
                            {searchResults.map(place => (
                                <div key={place.placeId} className="search-result-item">
                                    <div className="sr-main">
                                        <div className="sr-img">
                                            <img src={place.photoUrl || getPlaceholderImage(place.name)} alt={place.name} />
                                        </div>
                                        <div className="sr-info">
                                            <h4 className="truncate-2-lines" style={{ fontWeight: 700, fontSize: '14px', lineHeight: '1.2', marginBottom: '4px' }}>{place.name}</h4>
                                            <p className="text-caption text-secondary truncate">{place.address}</p>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginTop: '8px' }}>
                                        <button className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '13px', width: 'auto' }} onClick={() => handleAddAccResult(place)}>
                                            <Plus size={16} /> Añadir Alojamiento
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                    </div>
                </div>
            )}

            {poiDetail && (
                <PoiDetailModal
                    poi={trip.pois.find(p => p.id === poiDetail.id) || poiDetail}
                    trip={trip}
                    onClose={() => setPoiDetail(null)}
                    onDelete={() => { store.removePoi(tripId, poiDetail.id); setPoiDetail(null); }}
                    onUpdate={(updates) => store.updatePoi(tripId, poiDetail.id, updates)}
                    onShowOnMap={showPoiOnMap}
                    onSaveDistances={(records) => store.saveDistances(tripId, records)}
                />
            )}

            {accDetail && (
                <AccommodationDetailModal
                    acc={accDetail}
                    onClose={() => setAccDetail(null)}
                />
            )}

            {showBulkImport && <BulkImportModal tripId={tripId} addPoi={store.addPoi} onClose={() => setShowBulkImport(false)} />}

            {showImportTrip && (
                <ImportTripModal
                    tripId={tripId}
                    trip={trip}
                    importTripData={store.importTripData}
                    onClose={() => setShowImportTrip(false)}
                />
            )}

            {/* Selector: añadir un lugar a un día del itinerario */}
            {dayPickerPoi && (
                <div className="modal-overlay animate-fade-in" onClick={() => setDayPickerPoi(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
                        <div className="modal-header">
                            <div>
                                <h2 className="text-subtitle">Añadir a un día</h2>
                                <p className="text-caption text-secondary truncate" style={{ marginTop: 2, maxWidth: 260 }}>{dayPickerPoi.name}</p>
                            </div>
                            <button onClick={() => setDayPickerPoi(null)} className="modal-close"><X size={22} /></button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {seedDays.length === 0 && (
                                <p className="text-caption text-secondary" style={{ marginBottom: 4 }}>
                                    Aún no tienes días planificados. Crea el primero:
                                </p>
                            )}
                            {seedDays.map(day => {
                                const already = (day.paradas || []).includes(dayPickerPoi.id);
                                return (
                                    <button
                                        key={day.id}
                                        className="btn btn-outline"
                                        style={{ justifyContent: 'space-between', opacity: already ? 0.55 : 1 }}
                                        disabled={already}
                                        onClick={() => addPoiToDay(dayPickerPoi, day.id)}
                                    >
                                        <span>{day.title || `Día ${day.dia}`}</span>
                                        <span className="text-caption text-tertiary">{already ? 'ya incluido' : `${(day.paradas || []).length} paradas`}</span>
                                    </button>
                                );
                            })}
                            <button className="btn btn-primary" onClick={() => addPoiToDay(dayPickerPoi, 'new')}>
                                <Plus size={16} /> Crear un día nuevo con este lugar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}
