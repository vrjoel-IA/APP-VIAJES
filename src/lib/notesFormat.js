// Convierte las notas de investigación (un bloque denso, a menudo en una sola línea)
// en secciones legibles: [{ key, label, icon, body }] y, para el bloque de datos,
// [{ key:'datos', label, icon, pairs:[{k,v}] }].
//
// Formato REAL de la investigación (observado):
//   - Secciones separadas por " — " (guion largo con espacios) o por saltos de línea.
//   - Etiquetas en mayúsculas seguidas de ':'  →  "POR QUÉ MERECE LA PENA:", "CONSEJOS:",
//     "OBSERVACIONES:", "JOYA OCULTA:".
//   - Un bloque de datos con pares "Clave: Valor" separados por " | "
//     (Valoración, Precio, Horario, Aparcamiento, Mejor época, Viento, Tiempo de visita…).
//   - Segmentos de enlace que se ELIMINAN: "Google Maps: …", "Cómo llegar: …",
//     "Origen del dato: …" (la app ya tiene mapa y rutas propias).
//   - Pares que dependían del alojamiento de la investigación (Distancia desde …, Tiempo
//     andando/coche…) se DESCARTAN: la app calcula esos tiempos en vivo desde el
//     alojamiento elegido, así que aquí serían engañosos.

// Segmentos que se eliminan por completo (enlaces y metadatos).
const DROP_SEG = /^(google\s*maps|c[oó]mo\s*llegar|origen\s*del\s*dato|ubicaci[oó]n|enlace|link)\s*[:：]/i;

// Enlaces sueltos a mapas dentro de un texto (por si aparecen inline).
const GMAPS_LINK = /(https?:\/\/)?(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)\S*/gi;

// Etiquetas de sección conocidas -> forma canónica + icono (nombre de lucide-react).
const SECTION_LABELS = [
  { re: /^por\s*qu[eé]\s*merece\s*la\s*pena\s*[:：]\s*/i, key: 'porque', label: 'Por qué merece la pena', icon: 'Sparkles' },
  { re: /^(qu[eé]\s*ver(?:\s*y\s*hacer)?|no\s*te\s*pierdas)\s*[:：]\s*/i, key: 'quever', label: 'Qué ver', icon: 'Eye' },
  { re: /^(consejos?|tips?|recomendaciones?)\s*[:：]\s*/i, key: 'consejos', label: 'Consejos', icon: 'Lightbulb' },
  { re: /^(observaciones|informaci[oó]n\s*importante|importante|avisos?)\s*[:：]\s*/i, key: 'importante', label: 'Información importante', icon: 'AlertCircle' },
  { re: /^joya\s*oculta\s*[:：]\s*/i, key: 'joya', label: 'Joya oculta', icon: 'Sparkles' },
  { re: /^descripci[oó]n\s*[:：]\s*/i, key: 'descripcion', label: 'Descripción', icon: 'FileText' },
  { re: /^horarios?\s*[:：]\s*/i, key: 'horario', label: 'Horario', icon: 'Clock' },
  { re: /^precios?\s*[:：]\s*/i, key: 'precio', label: 'Precio', icon: 'Ticket' },
  { re: /^(mejor\s*momento|mejor\s*[eé]poca)\s*[:：]\s*/i, key: 'mejormomento', label: 'Mejor momento', icon: 'Sun' },
  { re: /^(accesibilidad|aparcamiento|p[aá]rking|c[oó]mo\s*llegar\s*a\s*pie)\s*[:：]\s*/i, key: 'accesibilidad', label: 'Accesibilidad', icon: 'Accessibility' },
];

// Claves del bloque de datos que se ocultan por depender del alojamiento (la app las calcula).
const DROP_DATA_KEY = /^(distancia\s*desde|tiempo\s*andando|tiempo\s*en\s*coche|tiempo\s*en\s*transporte|tiempo\s*en\s*bici|c[oó]mo\s*llegar)/i;

// Marcadores emoji al inicio de un segmento (los quitamos, no aportan al texto).
const LEAD_MARKERS = /^(?:[\s⭐⚫🔵🟢🟡🟠🔴▪◾◦•·»–—-]+)+/u;

// Orden de salida de las secciones (lo que no esté aquí va al final, en orden de aparición).
const ORDER = ['descripcion', 'joya', 'porque', 'quever', 'datos', 'horario', 'precio', 'mejormomento', 'accesibilidad', 'consejos', 'importante'];

// ¿Un segmento es el bloque de datos "Clave: Valor | Clave: Valor …"?
function looksLikeData(seg) {
  if (seg.includes('|')) return true;
  return /^(valoraci[oó]n|precio|horario|aparcamiento|mejor\s*[eé]poca|viento|comarca|tiempo\s*de\s*visita)\s*[:：]/i.test(seg);
}

function parseDataPairs(seg) {
  return seg
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^([^:：]{2,40})\s*[:：]\s*(.+)$/);
      return m ? { k: m[1].trim(), v: m[2].trim() } : null;
    })
    .filter(Boolean)
    .filter((p) => !DROP_DATA_KEY.test(p.k));
}

// Divide `notas` en bloques legibles. Devuelve [] si no hay contenido.
export function parseNotes(notas) {
  if (!notas || !String(notas).trim()) return [];

  const segments = String(notas)
    .replace(/\r\n/g, '\n')
    .split(/\s+[—–]\s+|\n+/) // guion largo/corto con espacios, o saltos de línea reales
    .map((s) => s.trim())
    .filter(Boolean);

  const byKey = {};        // key -> block (secciones únicas)
  const descripcion = [];  // texto sin etiqueta
  let dataPairs = [];
  const extraOrder = [];   // claves no previstas, en orden de aparición

  const addBlock = (key, label, icon, body) => {
    if (!body) return;
    if (byKey[key]) { byKey[key].body += (byKey[key].body ? ' ' : '') + body; }
    else { byKey[key] = { key, label, icon, body }; if (!ORDER.includes(key)) extraOrder.push(key); }
  };

  for (let seg of segments) {
    seg = seg.replace(LEAD_MARKERS, '').trim();
    if (!seg) continue;
    // "IMPRESCINDIBLE." suelto: ya está en el estado del lugar, lo omitimos.
    if (/^imprescindible\.?$/i.test(seg)) continue;
    if (DROP_SEG.test(seg)) continue;

    if (looksLikeData(seg)) {
      dataPairs.push(...parseDataPairs(seg));
      continue;
    }

    const sec = SECTION_LABELS.find((s) => s.re.test(seg));
    if (sec) {
      const body = seg.replace(sec.re, '').replace(GMAPS_LINK, '').trim();
      if (sec.key === 'descripcion') descripcion.push(body);
      else addBlock(sec.key, sec.label, sec.icon, body);
      continue;
    }

    // Sin etiqueta reconocida -> descripción (quitando cualquier enlace suelto).
    const clean = seg.replace(GMAPS_LINK, '').replace(/[\s·•\-—:]+$/, '').trim();
    if (clean) descripcion.push(clean);
  }

  if (descripcion.length) {
    byKey.descripcion = { key: 'descripcion', label: 'Descripción', icon: 'FileText', body: descripcion.join(' ') };
  }
  if (dataPairs.length) {
    byKey.datos = { key: 'datos', label: 'Datos prácticos', icon: 'Info', pairs: dataPairs };
  }

  const keys = [...ORDER.filter((k) => byKey[k]), ...extraOrder.filter((k) => byKey[k] && !ORDER.includes(k))];
  return keys.map((k) => byKey[k]);
}

// Convierte texto de investigación denso en Markdown legible (para la Guía).
// Si ya parece Markdown (encabezados) o es corto, se devuelve tal cual.
export function researchToMarkdown(text) {
  if (!text) return '';
  const t = String(text);
  const hasMd = /^#{1,6}\s|\n#{1,6}\s|\n[-*]\s|\n\d+\.\s/.test(t);
  const isDense = /\s[—–]\s/.test(t) || /\s\|\s/.test(t);
  if (hasMd || !isDense) return t.replace(GMAPS_LINK, '').trim();

  const blocks = parseNotes(t);
  return blocks
    .map((b) => {
      if (b.pairs) {
        return `**${b.label}**\n` + b.pairs.map((p) => `- **${p.k}:** ${p.v}`).join('\n');
      }
      if (b.key === 'descripcion') return b.body;
      return `**${b.label}**\n${b.body}`;
    })
    .join('\n\n');
}
