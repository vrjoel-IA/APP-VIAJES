import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Globe, Map, Compass, Flame, TreePine, UtensilsCrossed, Waves, Camera } from 'lucide-react';
import { useTripStore } from '../store/useTripStore';
import './Home.css';

const FEATURED_DESTINATIONS = [
    { name: 'Tenerife', emoji: '🌋', tag: 'Naturaleza', color: '#10b981', desc: 'Volcanes, playas y el Teide' },
    { name: 'Barcelona', emoji: '🏛️', tag: 'Cultura', color: '#8b5cf6', desc: 'Arquitectura y gastronomía' },
    { name: 'Bali', emoji: '🌴', tag: 'Playa', color: '#3b82f6', desc: 'Paraíso tropical asiático' },
    { name: 'Patagonia', emoji: '🏔️', tag: 'Aventura', color: '#f97316', desc: 'Glaciares y montañas épicas' },
    { name: 'Kyoto', emoji: '⛩️', tag: 'Cultura', color: '#ef4444', desc: 'Templos y tradición japonesa' },
    { name: 'Ronda', emoji: '🌉', tag: 'Pueblo', color: '#f5a623', desc: 'El tajo y el casco histórico' },
    { name: 'Nueva York', emoji: '🗽', tag: 'Ciudad', color: '#3b82f6', desc: 'La ciudad que nunca duerme' },
    { name: 'Roma', emoji: '🛵', tag: 'Cultura', color: '#ef4444', desc: 'Historia y ruinas antiguas' },
    { name: 'Maldivas', emoji: '🏝️', tag: 'Playa', color: '#0ea5e9', desc: 'Aguas cristalinas y relax' },
    { name: 'Egipto', emoji: '🐪', tag: 'Historia', color: '#eab308', desc: 'Pirámides y el río Nilo' },
    { name: 'Islandia', emoji: '❄️', tag: 'Naturaleza', color: '#6366f1', desc: 'Auroras boreales y hielo' },
    { name: 'París', emoji: '🥐', tag: 'Ciudad', color: '#ec4899', desc: 'La ciudad del amor y arte' }
];

const TIPS = [
    { icon: <Map size={20} />, title: 'Optimiza tu ruta', desc: 'Genera un itinerario diario y Google Maps te dará la ruta óptima.', color: '#3b82f6' },
    { icon: <UtensilsCrossed size={20} />, title: 'Comidas incluidas', desc: 'El itinerario propone automáticamente restaurantes para almorzar y cenar.', color: '#f97316' },
    { icon: <Camera size={20} />, title: 'Tarjetas de visita', desc: 'Pulsa cualquier lugar para ver fotos, horarios y cómo llegar.', color: '#10b981' },
    { icon: <Waves size={20} />, title: 'Importa tu lista', desc: 'Pega tu lista de lugares organizados por categorías y los importamos todos.', color: '#8b5cf6' },
];

export default function Explore() {
    const navigate = useNavigate();
    const { createTrip } = useTripStore();
    const [searchDest, setSearchDest] = useState('');
    const [showAllDest, setShowAllDest] = useState(false);

    const visibleDestinations = showAllDest ? FEATURED_DESTINATIONS : FEATURED_DESTINATIONS.slice(0, 6);

    const handleQuickStart = async (destination) => {
        const id = await createTrip({ name: `Viaje a ${destination}`, destination });
        navigate(`/trip/${id}`);
    };

    const handleSearchStart = () => {
        if (!searchDest.trim()) return;
        handleQuickStart(searchDest.trim());
    };

    return (
        <div className="page-content" style={{ padding: '0 0 calc(var(--nav-height) + 40px) 0' }}>
            {/* Hero Banner */}
            <div style={{
                background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0d1b2a 100%)',
                padding: 'var(--space-xl) var(--space-lg) var(--space-2xl)',
                position: 'relative', overflow: 'hidden',
            }}>
                {/* Decorative blobs */}
                <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', filter: 'blur(40px)' }} />
                <div style={{ position: 'absolute', bottom: -20, left: -20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(16,185,129,0.1)', filter: 'blur(30px)' }} />

                <div style={{ position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Compass size={18} style={{ color: 'var(--color-primary)' }} />
                        <span style={{ color: 'var(--color-primary)', fontWeight: 700, fontSize: '13px' }}>Explorar</span>
                    </div>
                    <h1 style={{ color: 'white', fontSize: '28px', fontWeight: 900, lineHeight: 1.2, marginBottom: 8 }}>
                        ¿A dónde vas<br />a viajar? 🌍
                    </h1>
                    <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginBottom: 20 }}>
                        Busca un destino y planifica tu aventura en minutos.
                    </p>

                    {/* Search bar */}
                    <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 'var(--radius-lg)', padding: '10px 14px', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.15)' }}>
                        <Search size={18} style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0, marginTop: 1 }} />
                        <input
                            value={searchDest}
                            onChange={e => setSearchDest(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSearchStart()}
                            placeholder="Tenerife, París, Japón..."
                            style={{ flex: 1, background: 'none', border: 'none', color: 'white', fontSize: '15px', outline: 'none' }}
                        />
                        <button
                            onClick={handleSearchStart}
                            style={{ background: 'var(--color-primary)', border: 'none', borderRadius: 'var(--radius-md)', padding: '6px 14px', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}
                        >Crear</button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div style={{ padding: 'var(--space-lg)' }}>
                {/* Featured Destinations */}
                <div style={{ marginBottom: 'var(--space-xl)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                        <h2 className="text-subtitle">
                            <Flame size={16} style={{ display: 'inline', marginRight: 6, color: '#f97316' }} />
                            Destinos Populares
                        </h2>
                        <button
                            onClick={() => setShowAllDest(!showAllDest)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                        >
                            {showAllDest ? 'Ver menos' : 'Ver todos'}
                        </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {visibleDestinations.map(dest => (
                            <div key={dest.name}
                                className="card animate-fade-in-up"
                                style={{ padding: '14px', cursor: 'pointer', transition: 'transform 0.2s', overflow: 'hidden', position: 'relative' }}
                                onClick={() => handleQuickStart(dest.name)}
                                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                                onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                            >
                                <div style={{ position: 'absolute', top: -10, right: -10, fontSize: '48px', opacity: 0.15 }}>{dest.emoji}</div>
                                <div style={{ position: 'relative', zIndex: 1 }}>
                                    <div style={{ fontSize: '28px', marginBottom: 6, lineHeight: 1 }}>{dest.emoji}</div>
                                    <div style={{ fontWeight: 800, fontSize: '15px', marginBottom: 2 }}>{dest.name}</div>
                                    <div className="text-caption text-secondary" style={{ fontSize: '11px', marginBottom: 6 }}>{dest.desc}</div>
                                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${dest.color}20`, color: dest.color }}>
                                        {dest.tag}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Tips */}
                <div style={{ marginBottom: 'var(--space-xl)' }}>
                    <h2 className="text-subtitle" style={{ marginBottom: 'var(--space-md)' }}>
                        <TreePine size={16} style={{ display: 'inline', marginRight: 6, color: '#10b981' }} />
                        Cómo usar la app
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {TIPS.map((tip, i) => (
                            <div key={i} className="card" style={{ padding: '14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: `${tip.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tip.color, flexShrink: 0 }}>
                                    {tip.icon}
                                </div>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: 2 }}>{tip.title}</div>
                                    <div className="text-caption text-secondary">{tip.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* CTA */}
                <button
                    className="btn btn-accent btn-full"
                    onClick={() => navigate('/new-trip')}
                    style={{ padding: '16px' }}
                >
                    <Plus size={18} /> Crear viaje personalizado
                </button>
            </div>
        </div>
    );
}
