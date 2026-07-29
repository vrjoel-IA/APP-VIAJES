// Netlify Function: generate-itinerary
//
// Backend seguro para la generación de itinerarios con IA (Google Gemini).
// La GEMINI_API_KEY vive aquí como variable de entorno (Netlify → Site settings
// → Environment variables) y NUNCA llega al navegador.
//
// La IA actúa como GUÍA LOCAL EXPERTO y DISEÑA EL DÍA COMPLETO con razonamiento:
// bloques temáticos coherentes, horas de comida realistas (almuerzo ~14-15h,
// cena ~21-22h), ritmo lógico y un "porqué" en cada parada. También avisa de
// fiestas/eventos temporales según las fechas y sugiere lugares nuevos.
//
// El cliente solo geolocaliza, calcula trayectos con Google y lo pinta.
//
// Recibe (POST JSON): { destination, dayNumber, dayDate, tripStart, tripEnd,
//                       startTime, start, end, candidates }
// Devuelve: { dayTitle, summary, timeline, suggestions, events, model }

const MODEL_CANDIDATES = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-1.5-flash'];

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dayTitle: { type: 'STRING' },
    summary: { type: 'STRING' },
    timeline: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING' }, // 'poi' | 'meal' | 'free'
          poiId: { type: 'STRING' }, // solo para type 'poi' (id de un candidato)
          name: { type: 'STRING' },
          startTime: { type: 'STRING' }, // HH:MM
          durationMins: { type: 'NUMBER' },
          mealType: { type: 'STRING' }, // Desayuno | Almuerzo | Cena
          note: { type: 'STRING' }, // consejo/razonamiento de guía
        },
        required: ['type', 'name', 'startTime', 'durationMins'],
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
  },
  required: ['dayTitle', 'timeline'],
};

function buildPrompt({ destination, dayNumber, dayDate, tripStart, tripEnd, totalDays, startTime, start, end, candidates, instructions }) {
  const list = candidates
    .map(
      (c) =>
        `- id:${c.id} | ${c.name} | categoría:${c.category} | valoración:${c.rating ?? 'N/D'} (${c.reviews ?? 0} reseñas) | coord:${c.lat},${c.lng}`
    )
    .join('\n');

  const fecha = dayDate ? `La fecha concreta de este día es ${dayDate}.` : 'No se conoce la fecha exacta.';
  const rango = tripStart && tripEnd ? ` El viaje completo va del ${tripStart} al ${tripEnd}.` : '';
  const multi = totalDays && totalDays > 1
    ? ` Este día forma parte de un plan de ${totalDays} días: los lugares de la lista son SOLO los que aún no se han usado en días anteriores, así que reparte con sensatez y no intentes meterlo todo hoy.`
    : '';
  const indicaciones = instructions
    ? `\n\nINDICACIONES DEL USUARIO (PRIORITARIAS: respétalas por encima de lo demás siempre que sea razonable; si piden poco caminar, minimiza distancias a pie y agrupa por cercanía; si dan una hora de comida, respétala; si piden empezar temprano, adelanta el inicio):\n"${instructions}"`
    : '';

  return `Eres un GUÍA LOCAL EXPERTO de ${destination || 'el destino'}. Diseña el día como lo haría
un planificador humano con sentido común, NO como un asistente genérico que solo lista lugares.${indicaciones}

Planifica UN día completo (día ${dayNumber}). Empieza a las ${startTime} en el punto de inicio
y termina en el punto final.
${fecha}${rango}${multi}
Inicio: ${start.name} (${start.lat},${start.lng}).
Fin: ${end.name} (${end.lat},${end.lng}).

LUGARES CANDIDATOS del usuario (aún sin asignar a ningún día):
${list || '(ninguno)'}

REGLAS DE DISEÑO (muy importantes):
1. COHERENCIA POR BLOQUES. Agrupa actividades compatibles y por zona geográfica. Si una mañana
   es de PLAYA, dedícale un tiempo realista (2 a 4 h) y encadénala con cosas compatibles
   (paseo costero, chiringuito). NO pongas justo después una visita cultural a un pueblo si la
   gente va en bañador: los cambios de "registro" (playa → cultura) deben ocurrir en transiciones
   lógicas (después de comer, tras pasar por el alojamiento a cambiarse, etc.).
2. HORAS DE COMIDA REALISTAS (España): desayuno opcional ~9:00; ALMUERZO entre 14:00 y 15:00;
   CENA entre 21:00 y 22:30. NUNCA comer a las 12:00 ni cenar a las 19:00. Coloca la comida cerca
   de donde estés en ese momento.
3. RITMO REALISTA. Asigna startTime (HH:MM) y durationMins razonables a cada parada, contando los
   desplazamientos entre lugares (usa las coordenadas para estimar cercanía y no encadenar sitios
   lejanos sin sentido). No amontones; deja margen. Calidad sobre cantidad (3 a 6 paradas/día).
4. Prioriza los lugares mejor valorados e icónicos de entre los candidatos.
5. CONSTRUYE "timeline" como la secuencia ordenada del día:
   - type:"poi" para visitas a candidatos (incluye su poiId EXACTO de la lista).
   - type:"meal" con mealType para las comidas (no llevan poiId).
   - type:"free" para tiempo libre/paseo/descanso/atardecer que dé ritmo (sin poiId; no inventes
     lugares con dirección).
   - En "note" de cada parada, una frase de guía con el porqué o un consejo práctico
     (p. ej. "Lleva bañador y agua; comeremos cerca sin volver al hotel").
6. "summary": 2-3 frases explicando la lógica del día (qué bloque por la mañana, por la tarde…).
7. CONTEXTO TEMPORAL: ten en cuenta fiestas locales y eventos que coincidan con la fecha (San Juan,
   Fallas, Semana Santa, carnavales, fiestas patronales, festivales) y la temporada. Si algo
   relevante coincide, tenlo en cuenta en el plan y descríbelo en "events" (vacío si no hay nada).
8. "suggestions": hasta 3 lugares famosos/imprescindibles de ${destination || 'la zona'} que NO estén
   en los candidatos (solo nombre + razón; essential=true los imprescindibles). NO inventes coords.

Sé concreto, específico de la zona y la fecha, y con criterio de guía local.`;
}

async function callGemini(model, apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
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
      continue;
    }

    if (!res.ok) {
      const detail = await res.text();
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Error de Gemini (${res.status}).`, detail: detail.slice(0, 500) }) };
    }

    try {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { lastError = 'Gemini no devolvió contenido.'; continue; }
      const parsed = JSON.parse(text);
      return { statusCode: 200, headers, body: JSON.stringify({ ...parsed, model }) };
    } catch (err) {
      lastError = `No se pudo interpretar la respuesta de ${model}: ${String(err).slice(0, 200)}`;
      continue;
    }
  }

  return { statusCode: 502, headers, body: JSON.stringify({ error: `No se pudo generar con ningún modelo de Gemini. ${lastError}` }) };
};
