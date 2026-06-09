// Cliente de la generación de itinerarios con IA.
// Llama a la Netlify Function (que habla con Gemini) y resuelve las sugerencias
// de lugares nuevos contra Google Places para obtener datos reales.
import { searchPlacesByText } from './places';

const ENDPOINT = '/.netlify/functions/generate-itinerary';

// Pide a la IA el plan de un día. Devuelve { dayTitle, stops, suggestions, rationale }.
export async function generateAiItinerary(payload) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('No se pudo contactar con el servicio de IA. ¿Estás en el sitio desplegado o usando `netlify dev`?');
  }

  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* respuesta no-JSON */ }
    throw new Error(msg);
  }

  return res.json();
}

// Convierte las sugerencias de la IA (solo nombres) en lugares reales con
// coordenadas/foto/rating usando Google Places. Descarta las que no se encuentren.
export async function resolveSuggestions(suggestions, { destination, locationBias } = {}) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return [];

  const resolved = await Promise.all(
    suggestions.map(async (s) => {
      try {
        const query = destination ? `${s.name}, ${destination}` : s.name;
        const matches = await searchPlacesByText(query, { locationBias, limit: 1 });
        const place = matches[0];
        if (!place) return null;
        return { ...place, aiReason: s.reason, essential: !!s.essential };
      } catch {
        return null;
      }
    })
  );

  return resolved.filter(Boolean);
}
