// Netlify Function: generate-itinerary
//
// Backend seguro para la generación de itinerarios con IA (Google Gemini).
// La GEMINI_API_KEY vive aquí como variable de entorno y NUNCA llega al navegador.
//
// La IA actúa como GUÍA LOCAL EXPERTO y RAZONA la logística del día (no aplica reglas
// rígidas): agrupa por bloques compatibles, respeta horarios reales y comidas, tiene en
// cuenta EVENTOS con fecha (ferias, conciertos…) y JUSTIFICA cada decisión.
//
// Recibe (POST JSON): { destination, dayNumber, dayDate, tripStart, tripEnd, totalDays,
//   startTime, start, end, mode, fixed[], candidates[], assignedElsewhere[], events[],
//   instructions }
// Devuelve: { resumen_logica, avisos[], paradas[], model }

const MODEL_CANDIDATES = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-1.5-flash'];

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    resumen_logica: { type: 'STRING' },
    avisos: { type: 'ARRAY', items: { type: 'STRING' } },
    paradas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          hora: { type: 'STRING' },            // HH:MM
          nombre: { type: 'STRING' },
          tipo: { type: 'STRING' },            // lugar | evento | comida | trayecto | inicio | fin
          origen: { type: 'STRING' },          // fijado | ia | evento_fecha
          poi_id: { type: 'STRING' },          // id EXACTO del candidato/fijado (vacío si no aplica)
          duracion_min: { type: 'NUMBER' },
          descripcion: { type: 'STRING' },
          motivo: { type: 'STRING' },          // por qué aquí y a esta hora
        },
        required: ['hora', 'nombre', 'tipo'],
      },
    },
  },
  required: ['paradas'],
};

function line(prefix, arr, fmt) {
  if (!arr || arr.length === 0) return `${prefix}: (ninguno)`;
  return `${prefix}:\n` + arr.map(fmt).join('\n');
}

function buildPrompt(p) {
  const {
    destination, dayNumber, dayDate, tripStart, tripEnd, totalDays,
    startTime, start, end, mode, fixed = [], candidates = [],
    assignedElsewhere = [], events = [], instructions,
  } = p;

  const fecha = dayDate ? `La fecha EXACTA de este día es ${dayDate}.` : 'No se conoce la fecha exacta (no incluyas eventos).';
  const rango = tripStart && tripEnd ? ` El viaje va del ${tripStart} al ${tripEnd}.` : '';
  const multi = totalDays && totalDays > 1
    ? ` Este día forma parte de un plan de ${totalDays} días: reparte con sensatez, no metas todo hoy.`
    : '';
  const modoTxt = mode === 'ordenar'
    ? 'MODO "solo ordenar": usa EXCLUSIVAMENTE los lugares fijados; NO añadas lugares nuevos. Solo ordénalos, dales horario y añade paradas de comida.'
    : 'MODO "completar": incluye SIEMPRE todos los fijados y completa los huecos con los mejores candidatos de la lista (o algún imprescindible cercano que no esté en ella, marcándolo con origen "ia"). Añade paradas de comida.';

  const fixedList = line('LUGARES FIJADOS por el viajero (van SÍ o SÍ; usa su poi_id exacto)', fixed,
    (c) => `- poi_id:${c.id} | ${c.name} | ${c.category} | zona:${c.zona || 'N/D'} | coord:${c.lat},${c.lng}`);
  const candList = mode === 'ordenar' ? '' : '\n\n' + line('CANDIDATOS para completar (opcionales; usa su poi_id exacto)', candidates,
    (c) => `- poi_id:${c.id} | ${c.name} | ${c.category} | zona:${c.zona || 'N/D'} | valoración:${c.rating ?? 'N/D'} | coord:${c.lat},${c.lng}`);
  const asignados = assignedElsewhere.length ? `\n\nYA ASIGNADOS A OTROS DÍAS (no los repitas salvo que estén fijados): ${assignedElsewhere.join(', ')}.` : '';
  const eventList = events.length ? '\n\n' + line('EVENTOS con fecha que coinciden con este día (úsalos con prioridad si encajan; origen "evento_fecha"; respeta su horario fijo; NO inventes)', events,
    (e) => `- ${e.nombre}${e.tipo ? ` (${e.tipo})` : ''}${e.lugar ? ` en ${e.lugar}` : ''}${e.horario ? ` · ${e.horario}` : ''}${e.fechas ? ` · fechas: ${e.fechas}` : ''}`) : '';
  const indic = instructions ? `\n\nINDICACIONES DEL VIAJERO (PRIORITARIAS sobre todo lo demás): "${instructions}"` : '';

  return `Eres un GUÍA LOCAL EXPERTO de ${destination || 'el destino'} planificando UN día (día ${dayNumber}).
Empieza a las ${startTime} en el punto de inicio y termina en el punto final.
${fecha}${rango}${multi}
Inicio: ${start.name} (${start.lat},${start.lng}). Fin: ${end.name} (${end.lat},${end.lng}).

${modoTxt}

${fixedList}${candList}${asignados}${eventList}${indic}

Ordena el día con LÓGICA PRÁCTICA (como quien conoce la zona) y JUSTIFICA cada decisión.
No apliques reglas fijas; razona ESTE día. Considera:
- Coherencia de "vestuario y modo": evita alternancias incómodas (bañador+arena a un casco
  antiguo, o cortar un bloque de playa para una visita cultural y volver). Agrupa lo compatible
  en bloques, en el orden que tenga más sentido HOY (a veces playa por la mañana es lo lógico).
- Horarios reales: apertura de monumentos/bodegas, espectáculos, comidas en España
  (almuerzo ~14:00, cena ~21:00), hora real del atardecer para lugares de atardecer.
- Clima y estación (calor de mediodía en verano), geografía (minimiza coche, agrupa por
  cercanía, no vuelvas sobre tus pasos; la comida cerca de la SIGUIENTE parada como bisagra).
- Excursiones de jornada completa (p. ej. ferry): ocupan el día entero; si hay otros fijados
  ese día, dilo en "avisos" y no los incluyas.
- Duraciones realistas y tiempos de trayecto estimados.
- Los eventos con fecha son oportunidades únicas: organiza el día alrededor de su horario fijo.

Devuelve SOLO JSON válido (sin markdown) con este esquema:
{
  "resumen_logica": "2-4 frases: el planteamiento del día y por qué este orden y no otro",
  "avisos": ["opcional: conflictos, p. ej. lugares desplazados a otro día"],
  "paradas": [
    { "hora":"HH:MM", "nombre":"…", "tipo":"lugar|evento|comida|trayecto|inicio|fin",
      "origen":"fijado|ia|evento_fecha", "poi_id":"id del candidato/fijado o vacío",
      "duracion_min":90, "descripcion":"dato útil breve", "motivo":"1 frase: por qué aquí y a esta hora" }
  ]
}
La primera parada debe ser tipo "inicio" y la última tipo "fin". Sé concreto y de la zona.`;
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

  const { start, end } = payload;
  const fixed = payload.fixed || [];
  const candidates = payload.candidates || [];
  if (!start || !end) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Faltan datos: start o end.' }) };
  }
  if (fixed.length === 0 && candidates.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No hay lugares que planificar.' }) };
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

    if (res.status === 404) { lastError = `Modelo ${model} no disponible (404).`; continue; }

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
