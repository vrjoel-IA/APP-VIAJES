import { useState, useEffect, useRef, useMemo } from 'react';
import { BookOpen, ChevronDown, Map as MapIcon, CalendarPlus, Star } from 'lucide-react';
import { renderMarkdown } from '../lib/miniMarkdown';
import { CATEGORY_MAP, getPlaceholderImage } from '../utils/constants';

// Vista Guía: renderiza `secciones_guia` como documento navegable e interactivo.
// La guía y el resto de la app son los mismos datos vistos de dos maneras: cada sección
// puede enlazar lugares (lugares_relacionados) que aparecen como tarjetas accionables.
export default function GuideTab({ trip, onOpenPoi, onShowOnMap, onAddToDay }) {
    const secciones = trip.seccionesGuia || [];
    const [activeId, setActiveId] = useState(secciones[0]?.id || null);
    const [indexOpen, setIndexOpen] = useState(false);
    const sectionRefs = useRef({});

    // HTML de cada sección (memorizado para no re-parsear en cada render).
    const htmlBySection = useMemo(() => {
        const map = {};
        secciones.forEach(s => { map[s.id] = renderMarkdown(s.contenidoMd); });
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [secciones.map(s => s.id + (s.contenidoMd?.length || 0)).join(',')]);

    // Seguimiento de la sección activa al hacer scroll.
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter(e => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible[0]) setActiveId(visible[0].target.dataset.sectionId);
            },
            { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
        );
        Object.values(sectionRefs.current).forEach(el => el && observer.observe(el));
        return () => observer.disconnect();
    }, [secciones.length]);

    const goToSection = (id) => {
        setIndexOpen(false);
        const el = sectionRefs.current[id];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const poiById = (id) => trip.pois.find(p => p.id === id);
    const activeTitle = secciones.find(s => s.id === activeId)?.titulo || 'Índice';

    if (secciones.length === 0) {
        return (
            <div className="empty-state" style={{ marginTop: 'var(--space-xl)' }}>
                <BookOpen size={48} />
                <p className="text-body text-tertiary">
                    Esta guía se llena al importar una investigación con secciones. Usa "Importar investigación" en la pestaña Lugares.
                </p>
            </div>
        );
    }

    return (
        <div className="guide-wrap">
            {/* Índice: barra plegable en móvil */}
            <div className="guide-index-mobile">
                <button className="guide-index-toggle" onClick={() => setIndexOpen(o => !o)}>
                    <BookOpen size={16} />
                    <span className="truncate" style={{ flex: 1, textAlign: 'left' }}>{activeTitle}</span>
                    <ChevronDown size={16} style={{ transform: indexOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                </button>
                {indexOpen && (
                    <div className="guide-index-list">
                        {secciones.map(s => (
                            <button key={s.id} className={`guide-index-item ${activeId === s.id ? 'active' : ''}`} onClick={() => goToSection(s.id)}>
                                {s.titulo}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Índice: barra lateral fija en escritorio */}
            <aside className="guide-index-desktop">
                <p className="text-caption" style={{ fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Guía</p>
                {secciones.map(s => (
                    <button key={s.id} className={`guide-index-item ${activeId === s.id ? 'active' : ''}`} onClick={() => goToSection(s.id)}>
                        {s.titulo}
                    </button>
                ))}
            </aside>

            {/* Contenido */}
            <div className="guide-content">
                {secciones.map(s => {
                    const lugares = (s.lugaresRelacionados || []).map(poiById).filter(Boolean);
                    return (
                        <section
                            key={s.id}
                            data-section-id={s.id}
                            ref={el => { sectionRefs.current[s.id] = el; }}
                            className="card guide-section-card"
                            style={{ scrollMarginTop: '72px' }}
                        >
                            <div className="guide-section-head">
                                <span className="guide-section-index">{secciones.indexOf(s) + 1}</span>
                                <h2 className="guide-section-title">{s.titulo}</h2>
                            </div>
                            <div className="guide-md" dangerouslySetInnerHTML={{ __html: htmlBySection[s.id] }} />

                            {lugares.length > 0 && (
                                <div style={{ marginTop: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                                    <p className="text-caption" style={{ fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                                        Lugares de esta sección
                                    </p>
                                    {lugares.map(poi => (
                                        <div key={poi.id} className="card guide-place-card">
                                            <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0, alignItems: 'center', cursor: 'pointer' }} onClick={() => onOpenPoi(poi)}>
                                                <div className="poi-img" style={{ width: 52, height: 52, flexShrink: 0 }}>
                                                    <img src={poi.photoUrl || getPlaceholderImage(poi.name)} alt={poi.name}
                                                        onError={e => { e.currentTarget.src = getPlaceholderImage(poi.name); }} />
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <h4 style={{ fontWeight: 700, fontSize: 14 }} className="truncate">{poi.name}</h4>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                                        <span className="cat-dot" style={{ background: CATEGORY_MAP[poi.category]?.color || '#6b7280' }} />
                                                        <span className="text-caption text-secondary">{CATEGORY_MAP[poi.category]?.label || 'Lugar'}</span>
                                                        {poi.rating && (
                                                            <span className="text-caption" style={{ color: '#f5a623', display: 'flex', alignItems: 'center', gap: 2 }}><Star size={11} fill="#f5a623" /> {poi.rating}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                                <button className="guide-place-btn" title="Ver en el mapa" aria-label="Ver en el mapa" onClick={() => onShowOnMap(poi)}>
                                                    <MapIcon size={16} />
                                                </button>
                                                <button className="guide-place-btn" title="Añadir a un día" aria-label="Añadir a un día" onClick={() => onAddToDay(poi)}>
                                                    <CalendarPlus size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
