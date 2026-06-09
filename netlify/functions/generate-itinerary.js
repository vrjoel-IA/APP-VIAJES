// Netlify Function: generate-itinerary
//
// Backend seguro para la generación de itinerarios con IA (Google Gemini).
// La GEMINI_API_KEY vive aquí como variable de entorno (Netlify → Site settings
// → Environment variables) y NUNCA llega al navegador.
//
// Reparto de responsabilidades:
//   - Gemini: actúa como GUÍA LOCAL EXPERTO. Elige/prioriza entre los lugares del
//     usuario, sugiere lugares nuevos imprescindibles y avisa de fiestas/eventos
//     temporales según las fechas del viaje (San Juan, Fallas, fiestas patronales…).
//   - Google Places (en el cliente): valida y geolocaliza las sugerencias.
//
// Recibe (POST JSON): { destination, dayNumber, dayDate, tripStart, tripEnd,
//                       startTime, start, end, candidates }
// Devuelve: { dayTitle, stops, suggestions, events, rationale }

// Modelos a intentar en orden (el primero que responda se usa). Configurable con
// la variable GEMINI_MODEL. Esto evita el 404 si un nombre de modelo no existe
// para tu clave/versión de API.
const MODEL_CANDIDATES = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-1.5-flash'];

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
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          date: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['name', 'description'],
      },
    },
    rationale: { type: 'STRING' },
  },
  required: ['dayTitle', 'stops'],
};

function buildPrompt({ destination, dayNumber, dayDate, tripStart, tripEnd, startTime, start, end, candidates }) {
  const list = candidates
    .map(
      (c) =>
        `- id:${c.id} | ${c.name} | categoría:${c.category} | valoración:${c.rating ?? 'N/D'} (${c.reviews ?? 0} reseñas) | coord:${c.lat},${c.lng}`
    )
    .join('\n');

  const fecha = dayDate
    ? `La fecha concreta de este día es ${dayDate}.`
    : 'No se conoce la fecha exacta del viaje.';
  const rango = tripStart && tripEnd ? ` El viaje completo va del ${tripStart} al ${tripEnd}.` : '';

  return `Actúa como un GUÍA LOCAL EXPERTO de ${destination || 'el destino'}, no como un asistente genérico.
Conoces a fondo la zona: sus fiestas, tradiciones, temporadas y ritmo real.

Planifica UN solo día (día ${dayNumber}) de ruta. El día empieza a las ${startTime}.
${fecha}${rango}
Punto de inicio: ${start.name} (${start.lat},${start.lng}).
Punto de fin: ${end.name} (${end.lat},${end.lng}).

LUGARES CANDIDATOS que el usuario ya ha guardado (aún sin asignar a ningún día):
${list || '(ninguno)'}

INSTRUCCIONES:
1. De los candidatos, selecciona un subconjunto REALISTA para un único día: debe caber
   entre las ${startTime} y ~21:00 contando tiempo de visita y desplazamientos. Calidad
   sobre cantidad (normalmente 3 a 6 lugares según su tamaño y cercanía).
2. Prioriza los mejor valorados e icónicos, pero agrupa los que estén geográficamente
   CERCA entre sí y en la ruta entre inicio y fin, para minimizar distancias. Ordénalos.
3. CONTEXTO LOCAL Y TEMPORAL (muy importante): ten en cuenta fiestas locales y eventos
   temporales que coincidan con la fecha del viaje (p. ej. la noche de San Juan, las
   Fallas, Semana Santa, carnavales, fiestas patronales, mercados o festivales), así como
   la temporada/clima y horarios estacionales. Si algo relevante coincide con estas fechas
   en ${destination || 'la zona'}, tenlo en cuenta al elegir la zona y los lugares del día,
   y descríbelo en "events" (con su fecha si la sabes). No inventes eventos que no existan;
   si no hay ninguno relevante, devuelve "events" vacío.
4. Asigna a cada parada horas de visita razonables según su categoría.
5. Usa EXCLUSIVAMENTE los id de la lista de candidatos en "stops".
6. En "suggestions" propón hasta 3 lugares famosos o imprescindibles de ${destination || 'la zona'}
   que NO estén ya en la lista de candidatos. Marca essential=true los imprescindibles y
   essential=false los que serían un buen extra "si sobra tiempo". Solo nombre y razón
   breve. NO inventes coordenadas ni ids.
7. "dayTitle": un título corto y atractivo para el día.

Sé concreto y específico de la zona y la fecha; nada de respuestas genéricas.`;
}

async function callGemini(model, apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  return res;
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

  const prompt = buildPrompt(payload);
  let lastError = 'Sin respuesta';

  // Prueba los modelos en orden; si uno da 404 (no existe), pasa al siguiente.
  for (const model of MODEL_CANDIDATES) {
    let res;
    try {
      res = await callGemini(model, apiKey, prompt);
    } catch (err) {
      lastError = String(err).slice(0, 300);
      continue;
    }

    if (res.status === 404) {
      lastError = `Modelo ${model} no disponible (404).`;
      continue; // probar el siguiente modelo
    }

    if (!res.ok) {
      const detail = await res.text();
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Error de Gemini (${res.status}).`, detail: detail.slice(0, 500) }),
      };
    }

    try {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = 'Gemini no devolvió contenido.';
        continue;
      }
      const parsed = JSON.parse(text);
      return { statusCode: 200, headers, body: JSON.stringify({ ...parsed, model }) };
    } catch (err) {
      lastError = `No se pudo interpretar la respuesta de ${model}: ${String(err).slice(0, 200)}`;
      continue;
    }
  }

  return {
    statusCode: 502,
    headers,
    body: JSON.stringify({ error: `No se pudo generar con ningún modelo de Gemini. ${lastError}` }),
  };
};
