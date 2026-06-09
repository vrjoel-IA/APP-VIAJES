// Netlify Function: generate-itinerary
//
// Backend seguro para la generación de itinerarios con IA (Google Gemini).
// La GEMINI_API_KEY vive aquí como variable de entorno (Netlify → Site settings
// → Environment variables) y NUNCA llega al navegador.
//
// Reparto de responsabilidades:
//   - Gemini: curación/conocimiento — elige y prioriza entre los lugares del
//     usuario y sugiere lugares nuevos imprescindibles de la zona (solo nombres).
//   - Google Places (en el cliente): valida y geolocaliza esas sugerencias.
//
// Recibe (POST JSON): { destination, dayNumber, startTime, start, end, candidates }
// Devuelve: { dayTitle, stops:[{poiId,visitHours}], suggestions:[{name,reason,essential}], rationale }

const GEMINI_MODEL = 'gemini-2.0-flash';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dayTitle: { type: 'STRING' },
    stops: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          poiId: { type: 'STRING' },
          visitHours: { type: 'NUMBER' },
        },
        required: ['poiId', 'visitHours'],
      },
    },
    suggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          reason: { type: 'STRING' },
          essential: { type: 'BOOLEAN' },
        },
        required: ['name', 'reason', 'essential'],
      },
    },
    rationale: { type: 'STRING' },
  },
  required: ['dayTitle', 'stops', 'suggestions'],
};

function buildPrompt({ destination, dayNumber, startTime, start, end, candidates }) {
  const list = candidates
    .map(
      (c) =>
        `- id:${c.id} | ${c.name} | categoría:${c.category} | valoración:${c.rating ?? 'N/D'} (${c.reviews ?? 0} reseñas) | coord:${c.lat},${c.lng}`
    )
    .join('\n');

  return `Eres un planificador de viajes experto en ${destination || 'el destino'}.

Planifica UN solo día (día ${dayNumber}) de ruta. El día empieza a las ${startTime}.
Punto de inicio: ${start.name} (${start.lat},${start.lng}).
Punto de fin: ${end.name} (${end.lat},${end.lng}).

LUGARES CANDIDATOS que el usuario ya ha guardado (aún sin asignar a ningún día):
${list || '(ninguno)'}

INSTRUCCIONES:
1. De los candidatos, selecciona un subconjunto REALISTA para un único día: debe caber
   entre las ${startTime} y ~21:00 contando tiempo de visita y desplazamientos. Calidad
   sobre cantidad (normalmente 3 a 6 lugares según su tamaño y cercanía).
2. Prioriza los lugares MEJOR VALORADOS y más icónicos (valoración alta + muchas reseñas),
   pero agrupa los que estén geográficamente CERCA entre sí y en la ruta entre inicio y fin,
   para minimizar distancias. Ordénalos de forma lógica para recorrerlos.
3. Asigna a cada parada unas horas de visita razonables según su categoría (playa ~2.5h,
   naturaleza ~3.5h, cultura ~1.5h, etc.).
4. Usa EXCLUSIVAMENTE los id de la lista de candidatos en "stops".
5. Además, en "suggestions" propón hasta 3 lugares FAMOSOS o IMPRESCINDIBLES de ${destination || 'la zona'}
   que NO estén ya en la lista de candidatos. Marca essential=true los que consideres
   imprescindibles y essential=false los que serían un buen extra "si sobra tiempo".
   Da solo el nombre y una razón breve. NO inventes coordenadas ni ids.
6. "dayTitle": un título corto y atractivo para el día.`;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Falta GEMINI_API_KEY en el servidor.' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cuerpo JSON inválido.' }) };
  }

  const { start, end, candidates } = payload;
  if (!start || !end || !Array.isArray(candidates)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan datos: start, end o candidates.' }) };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(payload) }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Error de Gemini (${res.status}).`, detail: detail.slice(0, 500) }) };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Gemini no devolvió contenido.' }) };
    }

    const parsed = JSON.parse(text);
    return { statusCode: 200, headers, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Fallo generando el itinerario.', detail: String(err).slice(0, 300) }) };
  }
};
