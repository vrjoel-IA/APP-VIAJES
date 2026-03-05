import { useNavigate } from 'react-router-dom';
import { Plus, MapPin, Calendar, ChevronRight, Sparkles, Trash2 } from 'lucide-react';
import { useTripStore } from '../store/useTripStore';
import { formatDate, getPlaceholderImage } from '../utils/constants';
import './Home.css';

export default function Home() {
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
            {/* Greeting */}
            <div className="animate-fade-in-up" style={{ marginBottom: 'var(--space-xl)' }}>
                <p className="text-caption text-tertiary" style={{ marginBottom: '4px' }}>Bienvenido de nuevo</p>
                <h1 className="text-hero">Planifica tu<br />próxima aventura ✨</h1>
            </div>

            {/* Hero CTA Card */}
            <div
                className="card-hero animate-fade-in-up"
                style={{ marginBottom: 'var(--space-xl)', cursor: 'pointer', animationDelay: '80ms' }}
                onClick={() => navigate('/new-trip')}
                id="create-trip-cta"
            >
                <div style={{ position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <Sparkles size={20} style={{ color: 'var(--color-primary)' }} />
                        <span className="text-small" style={{ color: 'var(--color-primary)' }}>Nuevo viaje</span>
                    </div>
                    <h2 className="text-title" style={{ marginBottom: '8px' }}>Crear un Nuevo<br />Viaje Mágico</h2>
                    <p className="text-body text-secondary" style={{ marginBottom: '20px' }}>
                        Añade los lugares que quieres visitar y encuentra el alojamiento perfecto.
                    </p>
                    <button className="btn btn-primary" style={{ padding: '12px 24px' }}>
                        <Plus size={18} />
                        Comenzar
                    </button>
                </div>
            </div>

            {/* Trips List */}
            {trips.length > 0 && (
                <div className="animate-fade-in-up" style={{ animationDelay: '160ms' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                        <h2 className="text-subtitle">Tus Viajes</h2>
                        <span className="badge badge-primary">{trips.length}</span>
                    </div>

                    <div className="trips-list stagger">
                        {trips.map((trip) => (
                            <div
                                key={trip.id}
                                className="trip-card card animate-fade-in-up"
                                id={`trip-${trip.id}`}
                            >
                                {/* Clicable para ir al viaje */}
                                <div onClick={() => handleTripClick(trip.id)} style={{ width: '100%', cursor: 'pointer' }}>
                                    <div className="trip-card-img">
                                        <img src={getPlaceholderImage(trip.destination || trip.name)} alt={trip.name} />
                                        <div className="trip-card-overlay">
                                            <span className="badge badge-primary">{trip.pois.length} lugares</span>
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
                                    </div>
                                </div>

                                {/* Zona inferior con las acciones (Fuera de la zona clicleable del viaje) */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px var(--space-lg)', borderTop: '1px solid var(--border-color)', marginTop: '12px' }}>
                                    <div style={{ display: 'flex', gap: '6px' }} onClick={() => handleTripClick(trip.id)}>
                                        {trip.accommodations.length > 0 && <span className="badge badge-accent">🏨 {trip.accommodations.length}</span>}
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
                        ))}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {trips.length === 0 && (
                <div className="empty-state animate-fade-in" style={{ marginTop: 'var(--space-2xl)' }}>
                    <MapPin size={56} />
                    <p className="text-body text-tertiary">
                        Aún no tienes viajes.<br />¡Crea tu primera aventura!
                    </p>
                </div>
            )}
        </div>
    );
}
