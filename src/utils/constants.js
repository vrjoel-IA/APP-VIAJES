export const CATEGORIES = [
    { id: 'beach', label: 'Playas', emoji: '🏖️', color: '#10b981' },
    { id: 'culture', label: 'Cultura', emoji: '🏛️', color: '#256af4' },
    { id: 'monument', label: 'Monumentos', emoji: '🗽', color: '#6366f1' },
    { id: 'theme_park', label: 'Parque temático', emoji: '🎢', color: '#ec4899' },
    { id: 'activity', label: 'Actividad', emoji: '🧗‍♂️', color: '#f43f5e' },
    { id: 'mirador', label: 'Miradores', emoji: '🔭', color: '#0ea5e9' },
    { id: 'market', label: 'Mercados', emoji: '🛍️', color: '#f59e0b' },
    { id: 'airport', label: 'Aeropuertos', emoji: '✈️', color: '#64748b' },
    { id: 'food', label: 'Comida', emoji: '🍽️', color: '#f97316' },
    { id: 'nature', label: 'Naturaleza', emoji: '🌿', color: '#8b5cf6' },
    { id: 'other', label: 'Otros', emoji: '📍', color: '#6b7280' },
];

export const CATEGORY_MAP = CATEGORIES.reduce((acc, c) => {
    acc[c.id] = c;
    return acc;
}, {});

export function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '—';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
    });
}

// Placeholder image: SVG en data-URI, autocontenido. Funciona SIN conexión (no depende
// de un servicio externo) y respeta la CSP (img-src permite data:). Muestra la inicial
// del lugar sobre un degradado estable según el nombre.
export function getPlaceholderImage(seed) {
    const palettes = [
        ['#3b82f6', '#1d4ed8'], ['#8b5cf6', '#6d28d9'], ['#10b981', '#047857'],
        ['#f97316', '#c2410c'], ['#ec4899', '#be185d'], ['#06b6d4', '#0e7490'],
    ];
    const text = (seed || '📍').trim();
    const [c1, c2] = palettes[Math.abs(hashCode(text)) % palettes.length];
    // Inicial(es): primera letra, o dos si el nombre tiene varias palabras cortas.
    const initial = text.replace(/[^\p{L}\p{N} ]/gu, '').trim().charAt(0).toUpperCase() || '•';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#g)"/>
<text x="200" y="165" font-family="system-ui,sans-serif" font-size="120" font-weight="700" fill="#ffffff" fill-opacity="0.9" text-anchor="middle">${initial}</text>
</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash;
}
