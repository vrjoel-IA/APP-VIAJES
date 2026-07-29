// Renderizador de Markdown mínimo y seguro, sin dependencias externas.
//
// La app es una PWA que debe funcionar offline: evitamos añadir una librería pesada.
// Cubre lo que trae la investigación: encabezados, listas, negrita/cursiva, código en
// línea, enlaces, citas y párrafos. Escapa el HTML de entrada ANTES de aplicar formato,
// así el contenido importado no puede inyectar etiquetas arbitrarias.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Formato dentro de una línea: negrita, cursiva, código, enlaces.
function inline(text) {
  let t = escapeHtml(text);
  // Código en línea (antes que el resto para no formatear su interior).
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Enlaces [texto](url) — solo http(s) o anclas, para no permitir javascript:
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[^\s)]*)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // Negrita luego cursiva.
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  return t;
}

// Convierte un bloque de Markdown en HTML.
export function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let listType = null; // 'ul' | 'ol' | null
  let paragraph = [];

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.map(inline).join('<br/>')}</p>`);
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) { flushParagraph(); closeList(); continue; }

    // Encabezados
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(); closeList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    // Cita
    if (/^>\s?/.test(line)) {
      flushParagraph(); closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    // Lista desordenada
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    // Lista ordenada
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    // Texto normal: se acumula en el párrafo actual.
    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return out.join('\n');
}
