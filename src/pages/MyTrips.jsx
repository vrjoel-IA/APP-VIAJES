import { useNavigate } from 'react-router-dom';
import { Plus, MapPin, Calendar, ChevronRight, Sparkles, Trash2, Clock, Navigation } from 'lucide-react';
import { useTripStore } from '../store/useTripStore';
import { formatDate, getPlaceholderImage } from '../utils/constants';
import './Home.css';

export default function MyTrips() {
    const navigate = useNavigate();
    const { trips, setActiveTrip, deleteTrip } = useTripStore();

    const handleTripClick = (tripId) => {
        setActiveTrip(tripId);
        navigate(`/trip/${tripId}`);
    };

    const handleDelete = (e, tripId) => {
        e.stopPropagation();
        if (confirm('¿Eliminar este viaje?')) deleteTrip(tripId);
    };

    return (
        <div className="page-content" style={{ padding: 'var(--space-lg) var(--space-lg) calc(var(--nav-height) + 40px) var(--space-lg)' }}>
            <div className="animate-fade-in-up" style={{ marginBottom: 'var(--space-xl)' }}>
                <p className="text-caption text-tertiary" style={{ marginBottom: '4px' }}>Tu historial</p>
                <h1 className="text-hero">Mis Viajes 🧳</h1>
            </div>

            {trips.length > 0 ? (
                <div className="animate-fade-in-up stagger">
                    {trips.map((trip) => {
                        const itineraryHours = (trip.itineraries || []).reduce((sum, it) => {
                            return sum + (it.totalDurationSec || 0) / 3600;
                        }, 0);
                        const poiCount = trip.pois?.length || 0;

                        return (
                            <div key={trip.id} className="trip-card card animate-fade-in-up" id={`trip-${trip.id}`}>
                                <div onClick={() => handleTripClick(trip.id)} style={{ width: '100%', cursor: 'pointer' }}>
                                    <div className="trip-card-img">
                                        <img src={getPlaceholderImage(trip.destination || trip.name)} alt={trip.name} />
                                        <div className="trip-card-overlay">
                                            <span className="badge badge-primary">{poiCount} lugares</span>
                                        </div>
                                    </div>
                                    <div className="trip-card-info" style={{ paddingBottom: '0' }}>
                                        <h3 className="text-subtitle truncate">{trip.name}</h3>
                                        <div className="trip-card-meta">
                                            <span className="text-caption text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <MapPin size={14} /> {trip.destination || 'Sin destino'}
                                            </span>
                                            {trip.startDate && (
                                                <span className="text-caption text-tertiary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Calendar size={14} /> {formatDate(trip.startDate)}
                                                </span>
                                            )}
                                        </div>
                                        {/* Mini stats */}
                                        <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                                            {poiCount > 0 && (
                                                <span className="text-small text-tertiary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Navigation size={12} /> {poiCount} lugares
                                                </span>
                                            )}
                                            {itineraryHours > 0 && (
                                                <span className="text-small text-tertiary" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Clock size={12} /> {itineraryHours.toFixed(1)}h de ruta
                                                </span>
                                            )}
                                            {(trip.itineraries || []).length > 0 && (
                                                <span className="text-small" style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-primary)' }}>
                                                    📅 {trip.itineraries.length} día{trip.itineraries.length !== 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px var(--space-lg)', borderTop: '1px solid var(--border-color)', marginTop: '12px' }}>
                                    <div style={{ display: 'flex', gap: '6px' }} onClick={() => handleTripClick(trip.id)}>
                                        {trip.accommodations?.length > 0 && <span className="badge badge-accent">🏨 {trip.accommodations.length}</span>}
                                        {trip.selectedAccommodation && <span className="badge badge-gold">🏆 Base</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <button
                                            className="icon-btn-danger"
                                            onClick={(e) => handleDelete(e, trip.id)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: '#fee2e2', color: '#ef4444', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 'bold' }}
                                        >
                                            <Trash2 size={14} /> Eliminar
                                        </button>
                                        <ChevronRight size={20} style={{ color: 'var(--text-tertiary)' }} onClick={() => handleTripClick(trip.id)} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="empty-state animate-fade-in" style={{ marginTop: 'var(--space-2xl)' }}>
                    <MapPin size={56} />
                    <p className="text-body text-tertiary">Aún no tienes viajes.<br />¡Crea tu primera aventura!</p>
                    <button className="btn btn-primary" onClick={() => navigate('/new-trip')}>
                        <Plus size={16} /> Crear viaje
                    </button>
                </div>
            )}

            <button
                className="btn btn-outline btn-full"
                style={{ marginTop: 'var(--space-lg)' }}
                onClick={() => navigate('/new-trip')}
            >
                <Plus size={16} /> Nuevo Viaje
            </button>
        </div>
    );
}
