import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Search, Plus, MapPin, Trash2, Star, Clock, ExternalLink,
    Hotel, BarChart3, Map as MapIcon, List, X, Navigation, Heart,
    CheckCircle2, ChevronDown, ChevronUp, Trophy, ArrowRight, UserPlus
} from 'lucide-react';
import { Map, AdvancedMarker, InfoWindow, useApiIsLoaded } from '@vis.gl/react-google-maps';
import PageHeader from '../components/PageHeader';
import ItineraryTab from '../components/ItineraryTab';
import BulkImportModal from '../components/BulkImportModal';
import PoiDetailModal from '../components/PoiDetailModal';
import AccommodationDetailModal from '../components/AccommodationDetailModal';
import ShareTripModal from '../components/ShareTripModal';
import { useTripStore } from '../store/useTripStore';
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
    const [activeFilter, setActiveFilter] = useState('all');
    const [selectedMarker, setSelectedMarker] = useState(null);
    const [poiDetail, setPoiDetail] = useState(null);
    const [comparing, setComparing] = useState(false);
    const [comparisonResults, setComparisonResults] = useState(null);
    const [showBulkImport, setShowBulkImport] = useState(false);
    const [accDetail, setAccDetail] = useState(null);
    const [mapCenter, setMapCenter] = useState({
        lat: trip?.destinationLat || 28.2916,
        lng: trip?.destinationLng || -16.6291,
    });
    const [measureSource, setMeasureSource] = useState(null);
    const [measureDest, setMeasureDest] = useState(null);
    const [measureMode, setMeasureMode] = useState('DRIVING');
    const [measureResult, setMeasureResult] = useState(null);

    const placesService = useRef(null);
    const mapRef = useRef(null);
    const apiIsLoaded = useApiIsLoaded();

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

    // ===== COMPARISON =====
    const runComparison = useCallback(() => {
        if (!trip || trip.accommodations.length === 0 || trip.pois.length === 0) return;
        setComparing(true);

        const service = new window.google.maps.DistanceMatrixService();
        const origins = trip.accommodations.map(a => new window.google.maps.LatLng(a.lat, a.lng));
        const destinations = trip.pois.map(p => new window.google.maps.LatLng(p.lat, p.lng));

        service.getDistanceMatrix(
            { origins, destinations, travelMode: 'DRIVING', language: 'es' },
            (response, status) => {
                setComparing(false);
                if (status !== 'OK') return alert('Error al calcular distancias.');

                const results = trip.accommodations.map((acc, i) => {
                    const row = response.rows[i];
                    const distances = row.elements.map((el, j) => ({
                        poiId: trip.pois[j].id,
                        poiName: trip.pois[j].name,
                        durationSec: el.status === 'OK' ? el.duration.value : null,
                        durationText: el.status === 'OK' ? el.duration.text : 'N/A',
                        distanceText: el.status === 'OK' ? el.distance.text : 'N/A',
                    }));

                    const validDurations = distances.filter(d => d.durationSec !== null).map(d => d.durationSec);
                    const avgDuration = validDurations.length > 0 ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length : 0;
                    const maxDuration = validDurations.length > 0 ? Math.max(...validDurations) : 0;

                    // Weighted average considering visit frequency
                    let weightedSum = 0, weightTotal = 0;
                    distances.forEach((d, j) => {
                        if (d.durationSec !== null) {
                            const freq = trip.pois[j].visitFrequency || 1;
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
                setTab('compare');
            }
        );
    }, [trip, tripId, store]);

    // ===== MAP INIT =====
    const onMapLoad = useCallback((map) => {
        if (!mapRef.current) {
            mapRef.current = map;
            // Solo hacer panTo en la primera carga inicial del mapa
            if (mapCenter) map.panTo(mapCenter);
            const ps = new window.google.maps.places.PlacesService(map);
            placesService.current = ps;
        }
    }, [mapCenter]);

    if (store.loading) return <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontWeight: 800, color: 'var(--color-primary)' }}>Cargando viaje...</div>;
    if (!trip) return null;

    const filteredPois = activeFilter === 'all'
        ? trip.pois
        : trip.pois.filter(p => p.category === activeFilter);

    // ===== PLACES SEARCH =====
    const handleSearch = () => {
        if (!searchQuery.trim()) return;

        if (!placesService.current && apiIsLoaded) {
            placesService.current = new window.google.maps.places.PlacesService(document.createElement('div'));
        }

        if (!placesService.current) return;

        const center = trip.destinationLat && trip.destinationLng
            ? new window.google.maps.LatLng(trip.destinationLat, trip.destinationLng)
            : null;
        placesService.current.textSearch(
            {
                query: searchQuery,
                ...(center ? { location: center, radius: 50000 } : {}),
                language: 'es',
            },
            (results, status) => {
                if (status === window.google.maps.places.PlacesServiceStatus.OK) {
                    setSearchResults(results.slice(0, 8));
                } else {
                    setSearchResults([]);
                }
            }
        );
    };

    const handleAddSearchResult = (place, category) => {
        const photos = place.photos
            ? place.photos.slice(0, 6).map(p => p.getUrl({ maxWidth: 800 }))
            : [];
        store.addPoi(tripId, {
            name: place.name,
            placeId: place.place_id,
            category: category,
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            address: place.formatted_address || '',
            rating: place.rating || null,
            userRatingsTotal: place.user_ratings_total || null,
            photoUrl: photos[0] || null,
            photos: photos,
            openingHours: place.opening_hours?.weekday_text || null,
            types: place.types || [],
            website: place.website || null,
            phoneNumber: place.formatted_phone_number || null,
            priceLevel: place.price_level ?? null,
        });
        setSearchResults(prev => prev.filter(r => r.place_id !== place.place_id));
    };

    const handleAddAccResult = (place) => {
        store.addAccommodation(tripId, {
            name: place.name,
            address: place.formatted_address || '',
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            placeId: place.place_id,
            photoUrl: place.photos?.[0]?.getUrl({ maxWidth: 400 }) || null,
        });
        setSearchResults(prev => prev.filter(r => r.place_id !== place.place_id));
    };



    const handleSelectWinner = (accId) => {
        store.selectAccommodation(tripId, accId);
    };



    const TABS = [
        { id: 'places', label: 'Lugares', icon: List },
        { id: 'map', label: 'Mapa', icon: MapIcon },
        { id: 'hotels', label: 'Alojamiento', icon: Hotel },
        { id: 'compare', label: 'Comparar', icon: BarChart3 },
        { id: 'itinerary', label: 'Itinerario', icon: Navigation },
    ];

    return (
        <div className="page-content trip-view">
            <PageHeader
                title={trip.name}
                subtitle={trip.destination}
                onBack={() => navigate('/')}
                rightAction={
                    <button
                        onClick={() => setShowShareModal(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 'var(--radius-full)', color: 'var(--color-primary)', fontWeight: 600, fontSize: '14px', border: '1px solid var(--color-primary-light)' }}
                    >
                        <UserPlus size={16} /> Compartir
                    </button>
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
                    </button>
                ))}
            </div>

            {/* ===== TAB: PLACES ===== */}
            {tab === 'places' && (
                <div className="tab-content">
                    <div className="chip-row" style={{ padding: '0 var(--space-lg)', marginBottom: 'var(--space-md)' }}>
                        <button className={`chip ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => setActiveFilter('all')}>
                            📍 Todo
                        </button>
                        {CATEGORIES.map(c => (
                            <button key={c.id} className={`chip ${activeFilter === c.id ? 'active' : ''}`} onClick={() => setActiveFilter(c.id)}>
                                {c.emoji} {c.label}
                            </button>
                        ))}
                    </div>

                    {/* POI List */}
                    <div className="poi-list stagger" style={{ padding: '0 var(--space-lg)' }}>
                        {filteredPois.map(poi => (
                            <div key={poi.id} className="poi-item card animate-fade-in-up">
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); store.togglePoiActive(tripId, poi.id); }}
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
                                        <img src={poi.photoUrl || getPlaceholderImage(poi.name)} alt={poi.name} />
                                    </div>
                                    <div className="poi-info">
                                        <h3 className="text-body" style={{ fontWeight: 700 }}>{poi.name}</h3>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                            <span className="cat-dot" style={{ background: CATEGORY_MAP[poi.category]?.color || '#6b7280' }}></span>
                                            <span className="text-caption text-secondary">{CATEGORY_MAP[poi.category]?.label || 'Otro'}</span>
                                            {poi.rating && (
                                                <span className="text-caption" style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#f5a623' }}>
                                                    <Star size={12} fill="#f5a623" /> {poi.rating}
                                                </span>
                                            )}
                                        </div>
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
                            <p className="text-body text-tertiary">Añade lugares que quieras visitar</p>
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
                                onClick={() => setShowBulkImport(true)}
                            >
                                📋 Importar Lista de Lugares
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
                        {trip.pois.filter(p => p.isActive !== false).map(poi => (
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

                        {trip.accommodations.filter(a => a.isActive !== false).map(acc => (
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

                        {/* Info Window */}
                        {selectedMarker && (
                            <InfoWindow
                                position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
                                onCloseClick={() => setSelectedMarker(null)}
                            >
                                <div style={{ maxWidth: '200px', padding: '2px' }}>
                                    <h3 style={{ fontSize: '13px', fontWeight: 800, marginBottom: '2px', lineHeight: 1.2 }}>{selectedMarker.name}</h3>
                                    {selectedMarker.category && (
                                        <span className="text-secondary" style={{ fontSize: '10px' }}>{CATEGORY_MAP[selectedMarker.category]?.label}</span>
                                    )}
                                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '11px', width: '100%', borderRadius: '4px' }} onClick={() => {
                                            if (selectedMarker.placeId && !selectedMarker.category) setAccDetail(selectedMarker);
                                            else setPoiDetail(selectedMarker);
                                        }}>Ver Detalles</button>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button className="btn btn-outline" style={{ padding: '4px 6px', fontSize: '10px', flex: 1, borderRadius: '4px' }} onClick={() => setMeasureSource(selectedMarker)}>Desde aquí</button>
                                            <button className="btn btn-outline" style={{ padding: '4px 6px', fontSize: '10px', flex: 1, borderRadius: '4px' }} onClick={() => setMeasureDest(selectedMarker)}>Hasta aquí</button>
                                        </div>
                                    </div>
                                </div>
                            </InfoWindow>
                        )}
                    </Map>

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
                            <p className="text-body text-tertiary">Aún no has añadido alojamientos</p>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
                        <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { setShowAddAcc(true); setSearchResults([]); setSearchQuery(''); }}>
                            <Plus size={16} /> Añadir Alojamiento
                        </button>
                    </div>

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
                </div>
            )}

            {/* ===== TAB: COMPARE ===== */}
            {
                tab === 'compare' && (
                    <div className="tab-content" style={{ padding: 'var(--space-lg) var(--space-lg) calc(var(--nav-height) + 120px) var(--space-lg)' }}>
                        {!comparisonResults ? (
                            <div className="empty-state" style={{ marginTop: 'var(--space-xl)' }}>
                                <BarChart3 size={48} />
                                <p className="text-body text-tertiary">Añade lugares y alojamientos, luego pulsa "Comparar Ubicaciones"</p>
                                <button className="btn btn-primary" onClick={() => setTab('hotels')}>
                                    Ir a Alojamiento
                                </button>
                            </div>
                        ) : (
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
                        )}
                    </div>
                )}

            {/* ===== TAB: ITINERARY ===== */}
            {tab === 'itinerary' && (
                <div className="tab-content" style={{ padding: 'var(--space-lg) var(--space-lg) calc(var(--nav-height) + 120px) var(--space-lg)' }}>
                    <ItineraryTab trip={trip} store={store} />
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
                            {searchResults.map(place => (
                                <div key={place.place_id} className="search-result-item">
                                    <div className="sr-main">
                                        <div className="sr-img">
                                            <img src={place.photos?.[0]?.getUrl({ maxWidth: 100 }) || getPlaceholderImage(place.name)} alt={place.name} />
                                        </div>
                                        <div className="sr-info">
                                            <h4 className="truncate-2-lines" style={{ fontWeight: 700, fontSize: '14px', lineHeight: '1.2', marginBottom: '4px' }}>{place.name}</h4>
                                            <p className="text-caption text-secondary truncate">{place.formatted_address}</p>
                                            {place.rating && (
                                                <span className="text-caption" style={{ color: '#f5a623' }}>⭐ {place.rating}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="sr-actions" style={{ display: 'flex', gap: '8px', paddingLeft: '60px', marginTop: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
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
                                </div>
                            ))}
                            {searchResults.length === 0 && searchQuery && (
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
                                <div key={place.place_id} className="search-result-item">
                                    <div className="sr-main">
                                        <div className="sr-img">
                                            <img src={place.photos?.[0]?.getUrl({ maxWidth: 100 }) || getPlaceholderImage(place.name)} alt={place.name} />
                                        </div>
                                        <div className="sr-info">
                                            <h4 className="truncate-2-lines" style={{ fontWeight: 700, fontSize: '14px', lineHeight: '1.2', marginBottom: '4px' }}>{place.name}</h4>
                                            <p className="text-caption text-secondary truncate">{place.formatted_address}</p>
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
                    poi={poiDetail}
                    trip={trip}
                    onClose={() => setPoiDetail(null)}
                    onDelete={() => { store.removePoi(tripId, poiDetail.id); setPoiDetail(null); }}
                    onUpdate={(updates) => store.updatePoi(tripId, poiDetail.id, updates)}
                />
            )}

            {accDetail && (
                <AccommodationDetailModal
                    acc={accDetail}
                    onClose={() => setAccDetail(null)}
                />
            )}

            {showBulkImport && <BulkImportModal tripId={tripId} addPoi={store.addPoi} onClose={() => setShowBulkImport(false)} />}
        </div >
    );
}
