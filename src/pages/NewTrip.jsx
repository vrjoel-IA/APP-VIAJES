import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Calendar, Sparkles } from 'lucide-react';
import { useApiIsLoaded } from '@vis.gl/react-google-maps';
import PageHeader from '../components/PageHeader';
import { useTripStore } from '../store/useTripStore';
import './NewTrip.css';

export default function NewTrip() {
    const navigate = useNavigate();
    const { createTrip } = useTripStore();
    const apiIsLoaded = useApiIsLoaded();
    const [destination, setDestination] = useState('');
    const [destCoords, setDestCoords] = useState(null);
    const [tripName, setTripName] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const inputRef = useRef(null);
    const autocompleteService = useRef(null);
    const geocoder = useRef(null);

    useEffect(() => {
        if (apiIsLoaded) {
            autocompleteService.current = new window.google.maps.places.AutocompleteService();
            geocoder.current = new window.google.maps.Geocoder();
        }
    }, [apiIsLoaded]);

    const handleDestChange = (val) => {
        setDestination(val);
        if (val.length > 2 && autocompleteService.current) {
            autocompleteService.current.getPlacePredictions(
                { input: val, types: ['(regions)'], language: 'es' },
                (results) => {
                    setSuggestions(results || []);
                }
            );
        } else {
            setSuggestions([]);
        }
    };

    const handleSelectSuggestion = (suggestion) => {
        setDestination(suggestion.description);
        setSuggestions([]);
        if (geocoder.current) {
            geocoder.current.geocode({ placeId: suggestion.place_id }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    const loc = results[0].geometry.location;
                    setDestCoords({ lat: loc.lat(), lng: loc.lng() });
                }
            });
        }
    };

    const handleCreate = async () => {
        if (!destination.trim()) return;
        const tripId = await createTrip({
            name: tripName || `Viaje a ${destination}`,
            destination: destination,
            destinationLat: destCoords?.lat,
            destinationLng: destCoords?.lng,
            startDate: startDate || null,
            endDate: endDate || null,
        });
        navigate(`/trip/${tripId}`);
    };

    const isValid = destination.trim().length > 0;

    return (
        <div className="page-content">
            <PageHeader
                title="Nuevo Viaje"
                onClose={() => navigate('/')}
            />

            <div className="new-trip-content">
                {/* Destination Search */}
                <div className="animate-fade-in-up" style={{ animationDelay: '0ms' }}>
                    <label className="field-label">
                        <MapPin size={16} style={{ color: 'var(--color-primary)' }} />
                        ¿A dónde quieres ir?
                    </label>
                    <div className="input-group">
                        <div className="input-icon"><MapPin size={18} /></div>
                        <input
                            ref={inputRef}
                            className="input-field input-field-lg"
                            value={destination}
                            onChange={(e) => handleDestChange(e.target.value)}
                            placeholder="Tenerife, Gandía, Oporto..."
                            autoFocus
                            id="destination-input"
                        />
                    </div>
                    {suggestions.length > 0 && (
                        <ul className="suggestions-list">
                            {suggestions.map((s) => (
                                <li key={s.place_id} onClick={() => handleSelectSuggestion(s)} className="suggestion-item">
                                    <MapPin size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                    <span>{s.description}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Trip Name */}
                <div className="animate-fade-in-up" style={{ animationDelay: '80ms' }}>
                    <label className="field-label">
                        <Sparkles size={16} style={{ color: 'var(--color-primary)' }} />
                        Nombre del viaje <span className="text-tertiary">(opcional)</span>
                    </label>
                    <div className="input-group">
                        <div className="input-icon"><Sparkles size={18} /></div>
                        <input
                            className="input-field"
                            value={tripName}
                            onChange={(e) => setTripName(e.target.value)}
                            placeholder="Ej: Escapada Romántica 🌅"
                            id="trip-name-input"
                        />
                    </div>
                </div>

                {/* Dates */}
                <div className="animate-fade-in-up" style={{ animationDelay: '160ms' }}>
                    <label className="field-label">
                        <Calendar size={16} style={{ color: 'var(--color-primary)' }} />
                        Fechas <span className="text-tertiary">(opcional)</span>
                    </label>
                    <div className="dates-row">
                        <div className="date-box">
                            <span className="text-small text-tertiary">Llegada</span>
                            <input
                                type="date"
                                className="date-input"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                id="start-date"
                            />
                        </div>
                        <div className="date-divider">→</div>
                        <div className="date-box">
                            <span className="text-small text-tertiary">Salida</span>
                            <input
                                type="date"
                                className="date-input"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                id="end-date"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Sticky CTA */}
            <button
                className={`btn btn-accent btn-full btn-sticky ${!isValid ? 'btn-disabled' : ''}`}
                onClick={handleCreate}
                disabled={!isValid}
                id="create-trip-btn"
            >
                <Sparkles size={18} />
                Comenzar a planificar
            </button>
        </div>
    );
}
