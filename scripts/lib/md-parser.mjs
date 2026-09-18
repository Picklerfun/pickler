/* =============================================================================
 * scripts/lib/md-parser.mjs
 *
 * Markdown parser standalone para los specs/plans de Proflores. Sin deps.
 *
 * Soporta:
 *  - Headers (# .. ######)
 *  - Listas no numeradas (- * +) y numeradas (1. 2. ...)
 *  - Tasks (- [x] / - [ ])
 *  - Code blocks fenced (```lang ... ``` o ~~~lang ... ~~~)
 *  - Inline code (`code`)
 *  - Bold (**x** o __x__), italic (*x* o _x_), code-italic combinaciones simples
 *  - Links [text](url) (sin reference-style)
 *  - Tables con pipes
 *  - Blockquotes (>)
 *  - HR (--- o ***)
 *  - Paragraphs
 *  - Escapado de < > & " ' en contenido (preserva entidades existentes)
 *
 * NO soporta (intencional, fuera de scope de los specs):
 *  - Reference-style links / autolinks
 *  - Imágenes (los specs usan paths a assets/ — se respeta el markup MD
 *    sintáctico ![alt](src) y se renderiza como <img>)
 *  - Footnotes
 *  - Definition lists
 *  - HTML inline (se escapa)
 *
 * Diseño: line-based con un mini state machine. Cada bloque (paragraph, list,
 * code, table) se acumula en `buffer`, se flushea cuando termina.
 *
 * API:
 *   import { markdownToHtml } from './lib/md-parser.mjs';
 *   const html = markdownToHtml(mdSource);
 * ============================================================================= */

/** Escapa HTML SOLO para texto plano. Se llama después de aplicar inline
 *  replacements (que producen tags HTML válidos). */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Aplica inline replacements en un texto plano. Devuelve string con HTML.
 *  Orden: code (`), bold+italic, bold, italic, links, autolinks de URLs.
 *  No procesa code (...) — el contenido entre backticks se preserva tal cual. */
function inline(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const rest = text.slice(i);

    // Inline code `code`
    const cm = rest.match(/^`([^`\n]+)`/);
    if (cm) {
      tokens.push({ type: 'code', value: cm[1] });
      i += cm[0].length;
      continue;
    }

    // Link [text](url)
    const lm = rest.match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
    if (lm) {
      tokens.push({ type: 'link', text: lm[1], url: lm[2], title: lm[3] || '' });
      i += lm[0].length;
      continue;
    }

    // Image ![alt](url)
    const im = rest.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/);
    if (im) {
      tokens.push({ type: 'image', alt: im[1], url: im[2], title: im[3] || '' });
      i += im[0].length;
      continue;
    }

    // Bold + italic ***x*** or ___x___
    const bim = rest.match(/^(\*{3}|_{3})(.+?)\1/);
    if (bim) {
      tokens.push({ type: 'bolditalic', value: bim[2] });
      i += bim[0].length;
      continue;
    }

    // Bold **x** or __x__
    const bm = rest.match(/^(\*{2}|_{2})(.+?)\1/);
    if (bm) {
      tokens.push({ type: 'bold', value: bm[2] });
      i += bm[0].length;
      continue;
    }

    // Italic *x* or _x_  (no matchea **)
    const itm = rest.match(/^(\*|_)([^*_\n]+)\1/);
    if (itm) {
      tokens.push({ type: 'italic', value: itm[2] });
      i += itm[0].length;
      continue;
    }

    // Default: text (avance de 1 char)
    tokens.push({ type: 'text', value: text[i] });
    i += 1;
  }

  // Serialize tokens to HTML
  let html = '';
  for (const t of tokens) {
    if (t.type === 'text') html += escapeHtml(t.value);
    else if (t.type === 'code') html += `<code>${escapeHtml(t.value)}</code>`;
    else if (t.type === 'link') {
      const url = escapeHtml(t.url);
      const title = t.title ? ` title="${escapeHtml(t.title)}"` : '';
      html += `<a href="${url}"${title}>${inline(t.text)}</a>`;
    }
    else if (t.type === 'image') {
      const url = escapeHtml(t.url);
      const alt = escapeHtml(t.alt);
      const title = t.title ? ` title="${escapeHtml(t.title)}"` : '';
      html += `<img src="${url}" alt="${alt}"${title}>`;
    }
    else if (t.type === 'bolditalic') html += `<strong><em>${inline(t.value)}</em></strong>`;
    else if (t.type === 'bold') html += `<strong>${inline(t.value)}</strong>`;
    else if (t.type === 'italic') html += `<em>${inline(t.value)}</em>`;
  }

  // Collapse multiple text chars: nothing extra needed since escapeHtml is per-char
  return html;
}

/** Slugify para anchors de headers */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Renderiza una tabla MD a HTML.
 *  rows: array de líneas raw del MD (la separadora ya removida).
 *  cols: array de alineamientos (left/right/center). */
function renderTable(rows, cols) {
  if (rows.length === 0) return '';
  const splitRow = (line) => {
    // Remove leading/trailing pipes if present
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  };
  const header = splitRow(rows[0]);
  const body = rows.slice(1).map(splitRow);

  let html = '<table>\n<thead>\n<tr>';
  header.forEach((h, i) => {
    const align = cols[i] ? ` style="text-align:${cols[i]}"` : '';
    html += `<th${align}>${inline(h)}</th>`;
  });
  html += '</tr>\n</thead>\n<tbody>\n';
  body.forEach(row => {
    html += '<tr>';
    row.forEach((c, i) => {
      const align = cols[i] ? ` style="text-align:${cols[i]}"` : '';
      html += `<td${align}>${inline(c)}</td>`;
    });
    html += '</tr>\n';
  });
  html += '</tbody>\n</table>';
  return html;
}

/** Parsea la línea separadora de tabla (--- :---: ---:) → array de alignments */
function parseTableAlign(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => {
    const t = c.trim();
    const l = t.startsWith(':');
    const r = t.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return '';
  });
}

/** Parser principal. Devuelve HTML como string. */
export function markdownToHtml(md, opts = {}) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  /** Tracking estructural */
  let i = 0;

  // listStack: array de { type: 'ul'|'ol', subtype?: 'task', indent: number }
  const listStack = [];

  /** Cierra listas MÁS anidadas que `indent`. Las del mismo nivel se mantienen
   *  abiertas para que items consecutivos se agrupen en un solo <ul>/<ol>. */
  function closeListsTo(indent) {
    while (listStack.length && listStack[listStack.length - 1].indent > indent) {
      const top = listStack.pop();
      out.push(`</${top.type}>`);
    }
  }
  function closeAllLists() {
    while (listStack.length) {
      const top = listStack.pop();
      out.push(`</${top.type}>`);
    }
  }

  /** Abre lista si no hay una activa al mismo indent del mismo tipo+subtype.
   *  Si hay una activa al mismo indent pero distinto tipo/subtype, la cierra y abre nueva. */
  function ensureList(indent, type, subtype) {
    closeListsTo(indent);
    const top = listStack[listStack.length - 1];
    if (!top || top.indent < indent || top.type !== type || top.subtype !== subtype) {
      if (top && top.indent === indent && (top.type !== type || top.subtype !== subtype)) {
        listStack.pop();
        out.push(`</${top.type}>`);
      }
      const cls = subtype === 'task' ? ' class="task-list"' : '';
      out.push(`<${type}${cls}>`);
      listStack.push({ type, subtype, indent });
    }
  }

  let inParagraph = false;
  let paragraphBuf = [];
  function flushParagraph() {
    if (inParagraph && paragraphBuf.length) {
      // Joining with space — los newlines simples en MD se ven como soft breaks
      out.push('<p>' + inline(paragraphBuf.join(' ').trim()) + '</p>');
    }
    paragraphBuf = [];
    inParagraph = false;
  }

  let inBlockquote = false;
  function closeBlockquote() {
    if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
  }

  while (i < lines.length) {
    const line = lines[i];

    // 1. Fenced code block ```lang ... ``` or ~~~lang ... ~~~
    const fenceMatch = line.match(/^(```|~~~)([a-zA-Z0-9_+\-]*)\s*$/);
    if (fenceMatch) {
      flushParagraph(); closeAllLists(); closeBlockquote();
      const fence = fenceMatch[1];
      const lang = fenceMatch[2];
      const codeLines = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === fence) { i++; break; }
        codeLines.push(l);
        i++;
      }
      const langClass = lang ? ` class="language-${lang}"` : '';
      out.push(`<pre><code${langClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // 2. HR --- *** ___
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph(); closeAllLists(); closeBlockquote();
      out.push('<hr>');
      i++;
      continue;
    }

    // 3. Headers # ... ######
    const hMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (hMatch) {
      flushParagraph(); closeAllLists(); closeBlockquote();
      const lvl = hMatch[1].length;
      const text = hMatch[2];
      const id = slugify(text);
      out.push(`<h${lvl} id="${id}">${inline(text)}</h${lvl}>`);
      i++;
      continue;
    }

    // 4. Blockquote >
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      flushParagraph(); closeAllLists();
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true; }
      // Soporte multi-línea blockquote → cada línea como texto
      const content = bqMatch[1];
      out.push(content === '' ? '<br>' : inline(content));
      i++;
      // Si la siguiente línea NO es blockquote, cerramos
      if (i < lines.length && !/^>/.test(lines[i])) closeBlockquote();
      continue;
    } else if (inBlockquote) {
      closeBlockquote();
    }

    // 5. Table: detect header line followed by separator
    if (line.includes('|') && i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(next)) {
        flushParagraph(); closeAllLists(); closeBlockquote();
        const aligns = parseTableAlign(next);
        const rows = [line];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
          rows.push(lines[i]);
          i++;
        }
        out.push(renderTable(rows, aligns));
        continue;
      }
    }

    // 6. Task list item - [x] / - [ ]   (must come BEFORE plain list)
    const taskMatch = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      flushParagraph(); closeBlockquote();
      const indent = taskMatch[1].length;
      const checked = taskMatch[3].toLowerCase() === 'x';
      const content = taskMatch[4];

      ensureList(indent, 'ul', 'task');
      const checkedAttr = checked ? ' checked' : '';
      out.push(`<li class="task-item"><label><input type="checkbox"${checkedAttr}> ${inline(content)}</label></li>`);
      i++;
      continue;
    }

    // 7. Bullet list -, *, +
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
      flushParagraph(); closeBlockquote();
      ensureList(ulMatch[1].length, 'ul', 'bullet');
      out.push(`<li>${inline(ulMatch[3])}</li>`);
      i++;
      continue;
    }

    // 8. Numbered list 1. 2. ...
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph(); closeBlockquote();
      ensureList(olMatch[1].length, 'ol', 'numbered');
      out.push(`<li>${inline(olMatch[2])}</li>`);
      i++;
      continue;
    }

    // 9. Empty line — flush paragraph + close lists
    if (line.trim() === '') {
      flushParagraph();
      closeAllLists();
      closeBlockquote();
      i++;
      continue;
    }

    // 10. Otherwise: it's a paragraph line
    if (!inParagraph) {
      // If we were in a list, the unindented text continues a paragraph; close lists
      if (listStack.length && !line.startsWith(' ')) {
        closeAllLists();
      }
      inParagraph = true;
    }
    paragraphBuf.push(line.trim());
    i++;
  }

  flushParagraph();
  closeAllLists();
  closeBlockquote();

  return out.join('\n');
}

/** Extrae el título principal (primer h1) del MD. Útil para el <title> del HTML. */
export function extractTitle(md) {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : 'Untitled';
}

/** Extrae headers para construir un TOC.
 *  Devuelve [{ level, text, id }] solo para h2/h3 (jerarquía navegable). */
export function extractToc(md) {
  const toc = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let inFence = false;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(##|###)\s+(.+?)\s*#*\s*$/);
    if (m) {
      toc.push({
        level: m[1].length,
        text: m[2].trim(),
        id: slugify(m[2].trim()),
      });
    }
  }
  return toc;
}
