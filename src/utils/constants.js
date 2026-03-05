export const CATEGORIES = [
    { id: 'beach', label: 'Playas', emoji: '🏖️', color: '#10b981' },
    { id: 'culture', label: 'Cultura', emoji: '🏛️', color: '#256af4' },
    { id: 'monument', label: 'Monumentos', emoji: '🗽', color: '#6366f1' },
    { id: 'theme_park', label: 'Parque temático', emoji: '🎢', color: '#ec4899' },
    { id: 'activity', label: 'Actividad', emoji: '🧗‍♂️', color: '#f43f5e' },
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

// Placeholder image
export function getPlaceholderImage(seed) {
    const colors = ['3b82f6', '8b5cf6', '10b981', 'f97316', 'ec4899', '06b6d4'];
    const c = colors[Math.abs(hashCode(seed || 'x')) % colors.length];
    return `https://placehold.co/400x300/${c}/white?text=${encodeURIComponent(seed || '📍')}`;
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
