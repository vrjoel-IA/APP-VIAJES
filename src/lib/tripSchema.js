// Esquema del almacén del viaje (contrato de importación/exportación) y adaptadores.
//
// La app guarda internamente cada lugar con `lat`/`lng` separados y categorías propias
// (ver constants.js). El "contrato" de investigación usa `coords:[lat,lng]` y una
// taxonomía distinta. Toda la traducción contrato <-> interno vive aquí, en un solo sitio.
//
// - validateTrip(json)     -> { ok, errors[], data }   valida un JSON del contrato
// - importToInternal(json) -> estructuras internas con ids nuevos y referencias reescritas
// - exportFromInternal(t)  -> JSON del contrato (lo importado se puede volver a sacar)
// - haversineMeters(a, b)  -> distancia en metros (dedupe y estimaciones sin API)

export const SCHEMA_VERSION = 1;

// ---- Categorías: contrato -> app (constants.js) ----
// El contrato define 7 categorías; la app tiene 10. Mapeamos a las de la app para reutilizar
// colores, iconos y el mapa que ya funcionan. 'mirador' se añade nuevo en la app.
export const CONTRACT_TO_APP_CATEGORY = {
  playa: 'beach',
  pueblo: 'culture',
  naturaleza: 'nature',
  cultura: 'culture',
  mirador: 'mirador',
  actividad: 'activity',
  otro: 'other',
};

// ---- Categorías: app -> contrato (para exportar) ----
// El mapeo es con pérdida (varias categorías de la app caen en la misma del contrato).
export const APP_TO_CONTRACT_CATEGORY = {
  beach: 'playa',
  culture: 'cultura',
  monument: 'cultura',
  theme_park: 'actividad',
  activity: 'actividad',
  market: 'otro',
  airport: 'otro',
  food: 'otro',
  nature: 'naturaleza',
  mirador: 'mirador',
  other: 'otro',
};

export function contractCategoryToApp(cat) {
  if (!cat) return 'other';
  return CONTRACT_TO_APP_CATEGORY[String(cat).toLowerCase()] || 'other';
}

export function appCategoryToContract(cat) {
  return APP_TO_CONTRACT_CATEGORY[cat] || 'otro';
}

// Generador de ids compatible con el que usa el store.
export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

// ---- Geometría ----
export function haversineMeters(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Normaliza un nombre para comparar (sin tildes, minúsculas, sin signos).
export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// ¿Nombres suficientemente parecidos? (uno contenido en el otro tras normalizar).
export function namesSimilar(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ---- Validación del contrato ----
function isCoordPair(c) {
  return Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number';
}

// Devuelve { ok, errors:[], data }. `data` es el JSON ya saneado (arrays por defecto).
export function validateTrip(json) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, errors: ['El archivo no es un objeto JSON de viaje válido.'], data: null };
  }
  if (json.version != null && json.version !== SCHEMA_VERSION) {
    errors.push(`Versión de esquema no soportada (${json.version}). Se espera ${SCHEMA_VERSION}.`);
  }

  const arr = (v) => (Array.isArray(v) ? v : []);
  const lugares = arr(json.lugares);
  const bases = arr(json.bases);
  const eventos = arr(json.eventos);
  const gastronomia = arr(json.gastronomia);
  const secciones = arr(json.secciones_guia);
  const itinerarios = arr(json.itinerarios);

  if (json.lugares && !Array.isArray(json.lugares)) errors.push('"lugares" debe ser una lista.');
  if (json.bases && !Array.isArray(json.bases)) errors.push('"bases" debe ser una lista.');

  lugares.forEach((l, i) => {
    if (!l || typeof l !== 'object') { errors.push(`Lugar #${i + 1}: no es un objeto.`); return; }
    if (!l.nombre) errors.push(`Lugar #${i + 1}: falta "nombre".`);
    if (!isCoordPair(l.coords)) errors.push(`Lugar "${l.nombre || i + 1}": "coords" debe ser [lat, lng] numéricos.`);
  });
  bases.forEach((b, i) => {
    if (!b || typeof b !== 'object') { errors.push(`Base #${i + 1}: no es un objeto.`); return; }
    if (!b.nombre) errors.push(`Base #${i + 1}: falta "nombre".`);
    if (!isCoordPair(b.coords)) errors.push(`Base "${b.nombre || i + 1}": "coords" debe ser [lat, lng] numéricos.`);
  });

  const data = {
    version: SCHEMA_VERSION,
    destino: json.destino || '',
    fechas: json.fechas && typeof json.fechas === 'object' ? json.fechas : null,
    bases, lugares, eventos, gastronomia,
    logistica: json.logistica && typeof json.logistica === 'object' ? json.logistica : {},
    secciones_guia: secciones,
    itinerarios,
  };

  return { ok: errors.length === 0, errors, data };
}

// Resumen legible de lo que trae un JSON (para la pantalla de confirmación).
export function summarizeContract(data) {
  return {
    lugares: (data.lugares || []).length,
    bases: (data.bases || []).length,
    eventos: (data.eventos || []).length,
    gastronomia: (data.gastronomia || []).length,
    secciones: (data.secciones_guia || []).length,
    itinerarios: (data.itinerarios || []).length,
  };
}

// ---- Contrato -> interno ----
// Genera ids internos nuevos y reescribe TODAS las referencias (lugar_id, paradas,
// lugares_relacionados) a esos ids nuevos, para que el import sea autoconsistente.
export function importToInternal(rawJson) {
  const { data } = validateTrip(rawJson);
  const now = new Date().toISOString();

  // Mapa de id del contrato -> id interno nuevo (lugares y bases).
  const idMap = {};

  const pois = (data.lugares || []).map((l) => {
    const id = genId();
    if (l.id) idMap[l.id] = id;
    const [lat, lng] = Array.isArray(l.coords) ? l.coords : [null, null];
    return {
      id,
      name: l.nombre,
      placeId: l.place_id || null,
      category: contractCategoryToApp(l.categoria),
      lat, lng,
      address: l.direccion || '',
      municipio: l.municipio || '',
      rating: l.rating ?? null,
      photoUrl: l.photo_url || null,
      photos: Array.isArray(l.photos) ? l.photos : [],
      imprescindible: !!l.imprescindible,
      yaVisitado: !!l.ya_visitado,
      descartado: !!l.descartado,
      duracionEstimadaMin: typeof l.duracion_estimada_min === 'number' ? l.duracion_estimada_min : null,
      mejorMomento: l.mejor_momento || '',
      notas: l.notas || '',
      fuente: l.fuente || 'investigacion',
      isActive: l.descartado ? false : true,
      addedAt: now,
    };
  });

  // Bases del contrato -> alojamientos internos. La marcada `activa` será campamento base.
  let selectedAccommodation = null;
  const accommodations = (data.bases || []).map((b) => {
    const id = genId();
    if (b.id) idMap[b.id] = id;
    const [lat, lng] = Array.isArray(b.coords) ? b.coords : [null, null];
    if (b.activa) selectedAccommodation = id;
    return {
      id,
      name: b.nombre,
      address: b.direccion || '',
      lat, lng,
      notas: b.notas || '',
      fuente: 'investigacion',
      isActive: b.activa !== false,
      addedAt: now,
    };
  });

  const eventos = (data.eventos || []).map((e) => {
    const [lat, lng] = Array.isArray(e.coords) ? e.coords : [null, null];
    return {
      id: genId(),
      nombre: e.nombre || '',
      fechaInicio: e.fecha_inicio || null,
      fechaFin: e.fecha_fin || e.fecha_inicio || null,
      lugarId: e.lugar_id ? idMap[e.lugar_id] || null : null,
      lat, lng,
      notas: e.notas || '',
    };
  });

  const gastronomia = (data.gastronomia || []).map((g) => {
    const [lat, lng] = Array.isArray(g.coords) ? g.coords : [null, null];
    return {
      id: genId(),
      nombre: g.nombre || '',
      municipio: g.municipio || '',
      tipo: g.tipo || '',
      lat, lng,
      notas: g.notas || '',
    };
  });

  const seccionesGuia = (data.secciones_guia || []).map((s) => ({
    id: genId(),
    titulo: s.titulo || '',
    contenidoMd: s.contenido_md || '',
    lugaresRelacionados: (Array.isArray(s.lugares_relacionados) ? s.lugares_relacionados : [])
      .map((ref) => idMap[ref] || null)
      .filter(Boolean),
  }));

  // Itinerarios como SEMILLA: día + lista de paradas (ids reescritos). El motor rico
  // (IA/manual) los expande después; aquí solo se guardan.
  const itineraries = (data.itinerarios || []).map((it) => ({
    id: genId(),
    seed: true,
    dia: it.dia ?? null,
    fecha: it.fecha || null,
    baseId: it.base_id ? idMap[it.base_id] || null : null,
    paradas: (Array.isArray(it.paradas) ? it.paradas : []).map((ref) => idMap[ref] || null).filter(Boolean),
    title: it.dia ? `Día ${it.dia}` : 'Día importado',
    notas: it.notas || '',
  }));

  return {
    meta: {
      destino: data.destino || '',
      startDate: data.fechas?.inicio || null,
      endDate: data.fechas?.fin || null,
    },
    pois,
    accommodations,
    selectedAccommodation,
    eventos,
    gastronomia,
    logistica: data.logistica || {},
    seccionesGuia,
    itineraries,
  };
}

// ---- Interno -> contrato ----
export function exportFromInternal(trip) {
  const t = trip || {};
  return {
    version: SCHEMA_VERSION,
    destino: t.destination || '',
    fechas: { inicio: t.startDate || null, fin: t.endDate || null },
    bases: (t.accommodations || []).map((a) => ({
      id: a.id,
      nombre: a.name,
      direccion: a.address || '',
      coords: [a.lat, a.lng],
      activa: t.selectedAccommodation === a.id || a.isActive !== false,
      notas: a.notas || '',
    })),
    lugares: (t.pois || []).map((p) => ({
      id: p.id,
      nombre: p.name,
      place_id: p.placeId || undefined,
      categoria: appCategoryToContract(p.category),
      coords: [p.lat, p.lng],
      municipio: p.municipio || '',
      direccion: p.address || '',
      imprescindible: !!p.imprescindible,
      ya_visitado: !!p.yaVisitado,
      descartado: !!p.descartado,
      duracion_estimada_min: p.duracionEstimadaMin ?? undefined,
      mejor_momento: p.mejorMomento || '',
      notas: p.notas || '',
      rating: p.rating ?? undefined,
      photo_url: p.photoUrl || undefined,
      fuente: p.fuente || 'manual',
    })),
    eventos: (t.eventos || []).map((e) => ({
      id: e.id,
      nombre: e.nombre,
      fecha_inicio: e.fechaInicio || null,
      fecha_fin: e.fechaFin || null,
      lugar_id: e.lugarId || null,
      coords: e.lat != null ? [e.lat, e.lng] : null,
      notas: e.notas || '',
    })),
    gastronomia: (t.gastronomia || []).map((g) => ({
      id: g.id,
      nombre: g.nombre,
      municipio: g.municipio || '',
      coords: g.lat != null ? [g.lat, g.lng] : null,
      tipo: g.tipo || '',
      notas: g.notas || '',
    })),
    logistica: t.logistica || {},
    secciones_guia: (t.seccionesGuia || []).map((s) => ({
      id: s.id,
      titulo: s.titulo,
      contenido_md: s.contenidoMd || '',
      lugares_relacionados: s.lugaresRelacionados || [],
    })),
    itinerarios: (t.itineraries || [])
      .filter((it) => it.seed)
      .map((it) => ({
        dia: it.dia ?? null,
        fecha: it.fecha || null,
        base_id: it.baseId || null,
        paradas: it.paradas || [],
        notas: it.notas || '',
      })),
  };
}
