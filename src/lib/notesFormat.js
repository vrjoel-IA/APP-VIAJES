// Convierte las notas libres de un lugar (texto de investigación, a menudo un bloque
// enorme) en secciones legibles: [{ key, label, icon, body }].
//
// La investigación no siempre viene con un formato fijo, así que detectamos secciones
// de dos formas:
//   1. Encabezados Markdown (`#`, `##`, `###`).
//   2. Etiquetas conocidas al principio de una línea, con o sin `:` y con o sin `**`
//      (p. ej. "Por qué merece la pena", "**Horario:**", "Consejos").
// Todo lo que va antes de la primera etiqueta reconocida se agrupa en "Descripción".
//
// Además elimina las líneas que son (o contienen) enlaces a Google Maps, porque la app
// ya tiene su propio mapa e integración de rutas.

// Etiquetas canónicas. `re` casa el encabezado; el orden define prioridad de match.
// `icon` es el nombre de un icono de lucide-react (lo resuelve el componente).
const SECTIONS = [
  { key: 'descripcion', label: 'Descripción', icon: 'FileText', re: /^descripci[oó]n$/i },
  { key: 'porque', label: 'Por qué merece la pena', icon: 'Sparkles', re: /^(por qu[eé] (merece la pena|ir|visitarlo?)|imprescindible|highlights?|lo mejor)$/i },
  { key: 'quever', label: 'Qué ver', icon: 'Eye', re: /^(qu[eé] ver( y hacer)?|qu[eé] hacer|no te pierdas)$/i },
  { key: 'consejos', label: 'Consejos', icon: 'Lightbulb', re: /^(consejos?|tips?|recomendaciones?)$/i },
  { key: 'horario', label: 'Horario', icon: 'Clock', re: /^(horarios?|apertura|cu[aá]ndo (ir|visitar))$/i },
  { key: 'precio', label: 'Precio', icon: 'Ticket', re: /^(precios?|entradas?|coste|tarifas?)$/i },
  { key: 'duracion', label: 'Duración recomendada', icon: 'Timer', re: /^(duraci[oó]n( recomendada| estimada| de la visita)?|tiempo( de visita| recomendado)?)$/i },
  { key: 'mejormomento', label: 'Mejor momento', icon: 'Sun', re: /^(mejor (momento|hora|[eé]poca)|cu[aá]ndo)$/i },
  { key: 'accesibilidad', label: 'Accesibilidad', icon: 'Accessibility', re: /^(accesibilidad|c[oó]mo llegar|acceso|aparcamiento|p[aá]rking|transporte)$/i },
  { key: 'importante', label: 'Información importante', icon: 'AlertCircle', re: /^(informaci[oó]n importante|importante|avisos?|ojo|atenci[oó]n|reservas?|hay que reservar)$/i },
];

const GMAPS_LINK = /(https?:\/\/)?(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)\S*/i;

const findSection = (label) => SECTIONS.find((s) => s.re.test(label.trim())) || null;

// ¿Esta línea abre una sección? Devuelve { section, rest } o null.
// Reconoce tres formas típicas de la investigación:
//   1. Cabecera "sola":   "Descripción"  |  "## Qué ver"  |  "**Consejos**"
//   2. Etiqueta + texto:  "Horario: 10:00 a 20:00"  |  "**Por qué merece la pena:** ..."
// `rest` es el texto que va tras la etiqueta (primera línea del cuerpo), si lo hay.
function matchSection(rawLine) {
  let line = rawLine.trim();
  if (!line) return null;
  line = line.replace(/^#{1,6}\s*/, ''); // encabezado markdown

  // Forma 1: la línea entera es la etiqueta (quitando ** y ':' final).
  const bareCandidate = line.replace(/^\*\*(.+?)\*\*$/, '$1').replace(/\s*:\s*$/, '').trim();
  if (bareCandidate.length <= 40 && !/[.!?]/.test(bareCandidate)) {
    const sec = findSection(bareCandidate);
    if (sec) return { section: sec, rest: '' };
  }

  // Forma 2: "Etiqueta: contenido" (con o sin ** alrededor de la etiqueta).
  const m = line.match(/^\*{0,2}\s*([^:*\n]{2,40}?)\s*:\s*\*{0,2}\s*(.+)$/);
  if (m) {
    const sec = findSection(m[1]);
    if (sec) return { section: sec, rest: m[2].trim() };
  }

  return null;
}

// Divide `notas` en secciones. Siempre devuelve al menos un bloque si hay contenido.
export function parseNotes(notas) {
  if (!notas || !String(notas).trim()) return [];

  const lines = String(notas).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  // Bloque inicial sin etiqueta -> Descripción.
  let current = { key: 'descripcion', label: 'Descripción', icon: 'FileText', lines: [] };

  for (const raw of lines) {
    if (GMAPS_LINK.test(raw)) {
      // Línea con enlace a Google Maps: la quitamos. Si además la línea es SOLO el enlace
      // (o "Ubicación: <enlace>"), se descarta entera; si mezcla texto útil, quitamos el enlace.
      const stripped = raw.replace(GMAPS_LINK, '')
        .replace(/\b(ver( en| aqu[ií])?|ubicaci[oó]n|mapa|google maps|c[oó]mo llegar|enlace|link)\s*:?\s*$/i, '')
        .replace(/[\s·•\-—:]+$/, '')
        .trim();
      if (!stripped) continue;
      current.lines.push(stripped);
      continue;
    }

    const hit = matchSection(raw);
    if (hit) {
      // Cierra el bloque actual si tiene contenido y abre el nuevo.
      if (current.lines.some((l) => l.trim())) blocks.push(current);
      const { section, rest } = hit;
      current = { key: section.key, label: section.label, icon: section.icon, lines: rest ? [rest] : [] };
      continue;
    }
    current.lines.push(raw);
  }
  if (current.lines.some((l) => l.trim())) blocks.push(current);

  return blocks
    .map((b) => ({ key: b.key, label: b.label, icon: b.icon, body: b.lines.join('\n').trim() }))
    .filter((b) => b.body);
}
