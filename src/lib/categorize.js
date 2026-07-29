// Clasificador de lugares en categorías de la app (ver constants.js).
//
// Estrategia en dos niveles, de más fiable a menos:
//   1. `types` de Google Places (New) — señal fuerte y eststructurada.
//   2. Heurística sobre el nombre y las notas (regex por palabras clave).
//
// Devuelve SIEMPRE un id válido de CATEGORIES. Si no hay señal, 'other'.
// Se usa al añadir lugares desde búsqueda, al importar listas de texto (BulkImport)
// y para reclasificar de forma idempotente lo importado sin categoría específica.

// --- Nivel 1: tipos de Google Places -> categoría de la app ---
// El primer type que casa gana, así que el orden importa (de específico a genérico).
const TYPE_RULES = [
  [['museum', 'art_gallery'], 'museo'],
  [['aquarium', 'zoo', 'amusement_park'], 'theme_park'],
  [['natural_feature', 'beach'], null], // se resuelve abajo con el nombre (playa vs naturaleza)
  [['hindu_temple', 'church', 'mosque', 'synagogue', 'place_of_worship'], 'monument'],
  [['tourist_attraction', 'historical_landmark', 'monument', 'castle'], 'monument'],
  [['park', 'national_park', 'campground', 'hiking_area'], 'nature'],
  [['shopping_mall', 'department_store', 'store', 'clothing_store'], 'shopping'],
  [['market', 'supermarket'], 'market'],
  [['restaurant', 'food', 'cafe', 'bar', 'bakery', 'meal_takeaway'], 'food'],
  [['night_club', 'casino', 'movie_theater', 'bowling_alley', 'spa'], 'ocio'],
  [['airport'], 'airport'],
  [['locality', 'administrative_area_level_3', 'postal_town'], 'pueblo'],
  [['administrative_area_level_1', 'administrative_area_level_2'], 'ciudad'],
];

// --- Nivel 2: palabras clave en nombre/notas -> categoría ---
// Orden de más específico a menos. Cada entrada: [regex, categoría].
const KEYWORD_RULES = [
  [/\bmirador(es)?\b|\bviewpoint\b/i, 'mirador'],
  [/\b(playa|cala|caleta|beach|arenal)\b/i, 'beach'],
  [/\b(ruta|sendero|senda|camino|gr-?\d|pr-?\d|trek|trail|hiking|senderismo)\b/i, 'ruta'],
  [/\b(muse[oa]|pinacoteca|galer[ií]a)\b/i, 'museo'],
  [/\b(catedral|bas[ií]lica|iglesia|ermita|monasterio|convento|castillo|alc[aá]zar|fortaleza|muralla|monumento|palacio|ruinas|yacimiento|acueducto|torre)\b/i, 'monument'],
  [/\b(mercad(o|illo)|zoco|market)\b/i, 'market'],
  [/\b(centro comercial|outlet|shopping|tienda|compras)\b/i, 'shopping'],
  [/\b(parque nacional|reserva|volc[aá]n|monta[ñn]a|pico|sierra|bosque|selva|cascada|catarata|lago|laguna|cueva|gruta|desierto|dunas|acantilado)\b/i, 'nature'],
  [/\b(restaurante|gastro|taberna|bodega|chiringuito|marisquer[ií]a|asador|bar\b)\b/i, 'food'],
  [/\b(parque tem[aá]tico|acu[aá]tico|theme park)\b/i, 'theme_park'],
  [/\b(discoteca|pub|casino|espect[aá]culo|teatro|cine|feria|parque de atracciones|balneario|spa|karting)\b/i, 'ocio'],
  [/\b(tour|excursi[oó]n|paseo en barco|kayak|buceo|snorkel|catamar[aá]n|experiencia|taller|cata|degustaci[oó]n|avistamiento)\b/i, 'experiencia'],
  [/\b(pueblo|villa|aldea|casco (hist[oó]rico|antiguo)|barrio)\b/i, 'pueblo'],
  [/\b(ciudad|city)\b/i, 'ciudad'],
  [/\b(aeropuerto|airport)\b/i, 'airport'],
];

function classifyByTypes(types) {
  if (!Array.isArray(types) || types.length === 0) return null;
  const set = types.map((t) => String(t).toLowerCase());
  for (const [keys, cat] of TYPE_RULES) {
    if (keys.some((k) => set.includes(k))) return cat; // cat puede ser null (ambiguo)
  }
  return null;
}

function classifyByKeywords(text) {
  if (!text) return null;
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(text)) return cat;
  }
  return null;
}

// Categoría de un lugar. `types` de Google si están; si no, nombre + notas.
export function guessCategory({ name = '', types = [], notas = '' } = {}) {
  const text = `${name}\n${notas}`;

  const byType = classifyByTypes(types);
  if (byType) return byType;

  // Ambiguo por tipo (natural_feature/beach): decide el nombre.
  const hasNatural = Array.isArray(types)
    && types.map((t) => String(t).toLowerCase()).some((t) => t === 'natural_feature' || t === 'beach');
  if (hasNatural) {
    if (/\b(playa|cala|caleta|beach|arenal)\b/i.test(name)) return 'beach';
    if (/\bmirador(es)?\b/i.test(name)) return 'mirador';
    return 'nature';
  }

  const byKeyword = classifyByKeywords(text);
  if (byKeyword) return byKeyword;

  return 'other';
}

// ¿Debe (re)clasificarse automáticamente? Solo si el lugar no tiene categoría útil
// y el usuario no la ha fijado a mano. Evita pisar decisiones humanas.
export function shouldAutoClassify(poi) {
  if (!poi || poi.categoryLocked) return false;
  const c = poi.category;
  return !c || c === 'other' || c === 'culture';
}
