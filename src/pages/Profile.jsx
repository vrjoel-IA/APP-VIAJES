import { useTripStore } from '../store/useTripStore';
import { useAuthStore } from '../store/useAuthStore';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { MapPin, Clock, Calendar, Navigation, Award, BarChart3, Luggage, LogOut } from 'lucide-react';
import { formatDate } from '../utils/constants';
import './Home.css';

function StatCard({ icon, label, value, color = 'var(--color-primary)' }) {
    return (
        <div className="card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
                width: 44, height: 44, borderRadius: 'var(--radius-md)',
                background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, color: color,
            }}>
                {icon}
            </div>
            <div>
                <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1 }}>{value}</div>
                <div className="text-caption text-secondary">{label}</div>
            </div>
        </div>
    );
}

export default function Profile() {
    const { trips } = useTripStore();
    const { user, signOut } = useAuthStore();
    const navigate = useNavigate();

    // ===== STATS =====
    const totalTrips = trips.length;
    const totalPois = trips.reduce((sum, t) => sum + (t.pois?.length || 0), 0);
    const totalAccs = trips.reduce((sum, t) => sum + (t.accommodations?.length || 0), 0);
    const totalItineraryDays = trips.reduce((sum, t) => sum + (t.itineraries?.length || 0), 0);
    const totalDrivingHours = trips.reduce((sum, t) => {
        return sum + (t.itineraries || []).reduce((s, it) => s + (it.totalDurationSec || 0) / 3600, 0);
    }, 0);
    const destinations = [...new Set(trips.map(t => t.destination).filter(Boolean))];
    const tripsWithAccommodation = trips.filter(t => t.selectedAccommodation).length;

    // Category breakdown across all trips
    const categoryCounts = {};
    trips.forEach(t => {
        (t.pois || []).forEach(p => {
            categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
        });
    });
    const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];

    const catEmoji = { beach: '🏖️', culture: '🏛️', food: '🍽️', nature: '🌿', other: '📍' };

    return (
        <div className="page-content" style={{ padding: 'var(--space-lg) var(--space-lg) calc(var(--nav-height) + 40px) var(--space-lg)' }}>
            {/* Header */}
            <div className="animate-fade-in-up" style={{ marginBottom: 'var(--space-xl)' }}>
                <p className="text-caption text-tertiary" style={{ marginBottom: '4px' }}>Tu resumen</p>
                <h1 className="text-hero">Mi Perfil ✈️</h1>
            </div>

            {/* Avatar + name block */}
            <div className="card animate-fade-in-up" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)', animationDelay: '60ms' }}>
                <div style={{
                    width: 64, height: 64, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '28px', flexShrink: 0,
                }}>✈️</div>
                <div>
                    <h2 style={{ fontWeight: 800, fontSize: '20px', marginBottom: 2 }}>Viajero Explorador</h2>
                    {user?.email && (
                        <p className="text-caption" style={{ color: 'var(--color-primary)', marginBottom: 4 }}>
                            {user.email}
                        </p>
                    )}
                    <p className="text-caption text-secondary">
                        {totalTrips === 0 ? 'Aún sin aventuras' : `${totalTrips} viaje${totalTrips !== 1 ? 's' : ''} planificado${totalTrips !== 1 ? 's' : ''}`}
                    </p>
                    {topCategory && (
                        <span className="badge badge-primary" style={{ marginTop: 6 }}>
                            {catEmoji[topCategory[0]] || '📍'} Fan de {topCategory[0]}
                        </span>
                    )}
                </div>
            </div>

            {/* Stats Grid */}
            <h2 className="text-subtitle animate-fade-in-up" style={{ marginBottom: 'var(--space-md)', animationDelay: '100ms' }}>
                Estadísticas
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 'var(--space-xl)', animationDelay: '140ms' }} className="animate-fade-in-up">
                <StatCard icon={<Luggage size={20} />} label="Viajes" value={totalTrips} />
                <StatCard icon={<MapPin size={20} />} label="Lugares" value={totalPois} color="#10b981" />
                <StatCard icon={<Clock size={20} />} label="Horas de ruta" value={`${totalDrivingHours.toFixed(1)}h`} color="#f97316" />
                <StatCard icon={<Calendar size={20} />} label="Días con ruta" value={totalItineraryDays} color="#8b5cf6" />
                <StatCard icon={<Navigation size={20} />} label="Alojamientos" value={totalAccs} color="#ef4444" />
                <StatCard icon={<Award size={20} />} label="Base elegida" value={tripsWithAccommodation} color="#f5a623" />
            </div>

            {/* Destinations visited */}
            {destinations.length > 0 && (
                <div className="animate-fade-in-up" style={{ marginBottom: 'var(--space-xl)', animationDelay: '180ms' }}>
                    <h2 className="text-subtitle" style={{ marginBottom: 'var(--space-md)' }}>Destinos Planificados</h2>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {destinations.map(d => (
                            <span key={d} className="badge badge-primary" style={{ fontSize: '13px', padding: '6px 14px', borderRadius: 'var(--radius-full)' }}>
                                📍 {d}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Category breakdown */}
            {Object.keys(categoryCounts).length > 0 && (
                <div className="animate-fade-in-up" style={{ marginBottom: 'var(--space-xl)', animationDelay: '220ms' }}>
                    <h2 className="text-subtitle" style={{ marginBottom: 'var(--space-md)' }}>
                        <BarChart3 size={18} style={{ display: 'inline', marginRight: 6 }} />
                        Tipo de Lugares
                    </h2>
                    <div className="card" style={{ padding: 'var(--space-md)' }}>
                        {Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                            const pct = Math.round((count / totalPois) * 100);
                            const colors = { beach: '#3b82f6', culture: '#8b5cf6', food: '#f97316', nature: '#10b981', other: '#6b7280' };
                            return (
                                <div key={cat} style={{ marginBottom: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                        <span className="text-body" style={{ fontWeight: 600 }}>{catEmoji[cat] || '📍'} {cat}</span>
                                        <span className="text-caption text-secondary">{count} ({pct}%)</span>
                                    </div>
                                    <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${pct}%`, background: colors[cat] || '#6b7280', borderRadius: 'var(--radius-full)', transition: 'width 0.6s ease' }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Recent trips */}
            {trips.length > 0 && (
                <div className="animate-fade-in-up" style={{ animationDelay: '260ms' }}>
                    <h2 className="text-subtitle" style={{ marginBottom: 'var(--space-md)' }}>Viajes Recientes</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {trips.slice(-3).reverse().map(t => (
                            <div key={t.id} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                                onClick={() => navigate(`/trip/${t.id}`)}>
                                <div style={{ fontSize: '24px', flexShrink: 0 }}>🗺️</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: '14px' }} className="truncate">{t.name}</div>
                                    <div className="text-caption text-secondary">{t.destination || 'Sin destino'} · {t.pois?.length || 0} lugares</div>
                                </div>
                                {t.startDate && <span className="text-small text-tertiary">{formatDate(t.startDate)}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {trips.length === 0 && (
                <div className="empty-state animate-fade-in" style={{ marginTop: 'var(--space-2xl)' }}>
                    <Award size={56} />
                    <p className="text-body text-tertiary">Aún no hay estadísticas.<br />¡Crea tu primer viaje!</p>
                </div>
            )}

            {/* Logout button */}
            <div className="animate-fade-in-up" style={{ animationDelay: '300ms', marginTop: 'var(--space-2xl)', display: 'flex', justifyContent: 'center' }}>
                <button
                    className="btn btn-outline"
                    style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)', background: 'transparent' }}
                    onClick={async () => {
                        await supabase.auth.signOut();
                        signOut();
                    }}
                >
                    <LogOut size={16} /> Cerrar Sesión
                </button>
            </div>
        </div>
    );
}
