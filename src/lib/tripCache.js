// Caché offline de los viajes en localStorage.
//
// Supabase sigue siendo la fuente de verdad. Esta caché permite que la app arranque al
// instante y siga funcionando sin conexión (uso típico: en la calle, con mala cobertura).
// Se guarda la última lista de viajes conocida, por usuario, y se re-hidrata al cargar.

const KEY_PREFIX = 'viaje:cache:';

function keyFor(userId) {
  return `${KEY_PREFIX}${userId || 'anon'}`;
}

export function saveCache(userId, trips) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify({ savedAt: Date.now(), trips }));
  } catch {
    // localStorage lleno o no disponible (modo privado): la app sigue, solo sin caché.
  }
}

export function loadCache(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.trips) ? parsed.trips : null;
  } catch {
    return null;
  }
}

export function clearCache(userId) {
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    /* nada que limpiar */
  }
}
