#!/usr/bin/env node
/* =============================================================================
 * scripts/docs-md-to-html.mjs
 *
 * Genera el HTML autogenerado de un spec o plan markdown del directorio
 * docs/superpowers/{specs,plans}/. Es el "view layer" del MD source — el
 * humano lee el HTML rico, el agente sigue trabajando sobre el MD.
 *
 * Uso:
 *
 *   node scripts/docs-md-to-html.mjs <path.md> [<path2.md> ...]
 *   node scripts/docs-md-to-html.mjs --all   # backfill de todos los specs/plans
 *   node scripts/docs-md-to-html.mjs --watch # opcional: re-genera al cambiar
 *
 * Argumentos:
 *   - Si el path no matchea docs/superpowers/(specs|plans)/*.md, no hace nada
 *     (exit 0). Útil para usar como hook PostToolUse de Claude Code donde
 *     se recibe el path de cualquier Write/Edit y el script filtra.
 *   - Genera <name>.html al lado del .md.
 *
 * Configuración del hook PostToolUse:
 *   ver bloque al final de docs/CLAUDE.md sección "MD → HTML autogenerado".
 *
 * No usa deps externas. Solo std lib + scripts/lib/md-parser.mjs.
 * ============================================================================= */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToHtml, extractTitle, extractToc } from './lib/md-parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_ROOT = path.join(REPO_ROOT, 'docs');
const SPECS_DIR = path.join(DOCS_ROOT, 'superpowers/specs');
const PLANS_DIR = path.join(DOCS_ROOT, 'superpowers/plans');

/** Detecta si un path corresponde a un MD que debemos procesar.
 *  Devuelve { kind: 'spec'|'plan'|null } */
function classify(absPath) {
  if (!absPath.endsWith('.md')) return { kind: null };
  if (absPath.includes('/docs/superpowers/specs/')) return { kind: 'spec' };
  if (absPath.includes('/docs/superpowers/plans/')) return { kind: 'plan' };
  return { kind: null };
}

/** Construye el HTML wrapper completo para un spec o plan.
 *  - Spec: TOC sticky, hero con badge "Spec".
 *  - Plan: TOC sticky, hero con badge "Plan", task checkboxes con persistencia
 *    en localStorage (key `pickler-md:<slug>:tasks`). */
function buildHtml({ kind, title, body, toc, slug }) {
  const styleRel = '../../overview/_styles.css';
  const syntaxRel = '../../overview/_syntax.js';
  const badgeClass = kind === 'spec' ? 'spec' : 'plan';
  const badgeLabel = kind === 'spec' ? 'Spec · markdown source' : 'Plan · markdown source';

  const tocHtml = toc.length
    ? `<nav class="toc"><div class="wrap">
       <ul>${toc.map(t => `<li><a href="#${t.id}">${escape(t.text)}</a></li>`).join('')}</ul>
     </div></nav>`
    : '';

  const taskScript = `
<script>
  // Persistencia de los checkboxes de task lists (pickler-md:<slug>:tasks)
  const SLUG = '${slug}';
  const KEY = \`pickler-md:\${SLUG}:tasks\`;
  const checks = [...document.querySelectorAll('ul.task-list input[type=checkbox]')];
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
      checks.forEach((c, i) => {
        if (typeof saved[i] === 'boolean') {
          c.checked = saved[i];
          c.closest('li').classList.toggle('done', c.checked);
        }
      });
    } catch {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(checks.map(c => c.checked))); } catch {}
  }
  checks.forEach(c => {
    c.closest('li').classList.toggle('done', c.checked);
    c.addEventListener('change', () => {
      c.closest('li').classList.toggle('done', c.checked);
      save();
    });
  });
  load();

  // Botón "Copy progress as MD"
  const $copy = document.getElementById('btn-copy-progress');
  const $toast = document.getElementById('toast');
  function showToast(msg) {
    $toast.textContent = msg;
    $toast.dataset.show = 'true';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { $toast.dataset.show = 'false'; }, 2200);
  }
  if ($copy) {
    $copy.addEventListener('click', async (e) => {
      const lines = ['# ' + document.title.split(' · ')[0] + ' — task progress', ''];
      lines.push('_Capturado en ' + new Date().toISOString() + '_', '');
      checks.forEach(c => {
        const text = c.closest('label').textContent.trim();
        lines.push('- [' + (c.checked ? 'x' : ' ') + '] ' + text);
      });
      try {
        await navigator.clipboard.writeText(lines.join('\\n'));
        e.currentTarget.dataset.copied = 'true';
        const prev = e.currentTarget.textContent;
        e.currentTarget.textContent = '✓ Copiado';
        showToast('Progress copiado — pégalo en el plan MD');
        setTimeout(() => {
          e.currentTarget.dataset.copied = 'false';
          e.currentTarget.textContent = prev;
        }, 1800);
      } catch {
        showToast('Clipboard no disponible');
      }
    });
  }
</script>`;

  // Botón sticky de progress (solo si hay task lists)
  const progressBtn = `
<div class="md-actions">
  <button type="button" class="btn primary" id="btn-copy-progress">📋 Copy progress as MD</button>
  <a href="${slug}.md" class="btn">📝 Ver source MD</a>
</div>`;

  return `<!doctype html>
<!--
  AUTOGENERADO desde ${slug}.md por scripts/docs-md-to-html.mjs

  ⚠️  NO EDITES ESTE ARCHIVO. Edita el .md y re-genera.
  El próximo Write al .md (con el hook activo) sobrescribirá este HTML.

  Reglas en docs/CLAUDE.md sección "MD → HTML autogenerado".
-->
<html lang="es-MX">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · ${kind === 'spec' ? 'Spec' : 'Plan'} · Pickler</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${styleRel}">
<script defer src="${syntaxRel}"></script>
<style>
  /* Overrides locales del MD-view */
  .wrap { max-width: 820px; }
  header.hero { padding: 24px 0 28px; }
  main { padding: 32px 0 64px; overflow-wrap: anywhere; }
  @media (max-width: 600px) { nav.toc { position: static; } }
  main h1 { display: none; } /* el h1 ya está en el hero */
  main h2 {
    font-size: 22px; font-weight: 800;
    margin: 36px 0 12px;
    letter-spacing: -0.015em;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--brand-soft);
    scroll-margin-top: 72px;
  }
  main h3 {
    font-size: 17px; font-weight: 700;
    margin: 24px 0 8px;
    letter-spacing: -0.01em;
    color: var(--ink);
    scroll-margin-top: 72px;
  }
  main h4 {
    font-size: 13px; font-weight: 700;
    margin: 20px 0 6px;
    text-transform: uppercase; letter-spacing: .06em;
    color: var(--ink-3);
  }
  main p { margin: 0 0 12px; font-size: 14.5px; line-height: 1.65; color: var(--ink); }
  main blockquote {
    margin: 14px 0;
    padding: 12px 18px;
    background: var(--brand-soft);
    border-left: 4px solid var(--brand);
    border-radius: var(--radius-s);
    color: var(--ink);
    font-size: 14px; line-height: 1.6;
  }
  main blockquote p { margin: 0; }
  main ul, main ol { margin: 8px 0 14px; padding-left: 26px; font-size: 14.5px; }
  main ul li, main ol li { margin: 4px 0; line-height: 1.55; }
  main ul.task-list { list-style: none; padding-left: 4px; }
  main ul.task-list li {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 4px 0;
  }
  main ul.task-list li input[type="checkbox"] {
    margin-top: 4px; accent-color: var(--brand); cursor: pointer;
    flex-shrink: 0;
  }
  main ul.task-list li label { flex: 1; cursor: pointer; }
  main ul.task-list li.done label { color: var(--ink-3); text-decoration: line-through; text-decoration-color: var(--ink-3); }

  main hr {
    border: none; border-top: 1px solid var(--line);
    margin: 32px 0;
  }
  main table {
    width: 100%; border-collapse: collapse;
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius); overflow: hidden;
    margin: 14px 0;
    font-size: 13.5px;
  }
  main table th, main table td {
    text-align: left; padding: 10px 14px;
    border-bottom: 1px solid var(--line);
  }
  main table th {
    background: var(--surface-2); font-weight: 700;
    font-size: 11.5px; color: var(--ink-3);
    text-transform: uppercase; letter-spacing: .06em;
  }
  main table tr:last-child td { border-bottom: none; }
  main img {
    max-width: 100%; height: auto;
    border-radius: var(--radius-s);
    border: 1px solid var(--line);
    margin: 10px 0;
  }

  .md-actions {
    display: flex; gap: 10px; flex-wrap: wrap;
    margin: 8px 0 28px;
    position: sticky; top: 60px;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(8px);
    padding: 10px 0; z-index: 25;
    border-bottom: 1px solid var(--line);
  }
  .md-actions .btn { text-decoration: none; }
</style>
</head>
<body data-slug="${slug}">

<div class="wrap">
  <nav class="crumb">
    <a href="../../overview/index.html">← Catálogo</a>
    <span class="sep">/</span>
    <a href="../">superpowers/${kind === 'spec' ? 'specs' : 'plans'}</a>
    <span class="sep">/</span>
    <span class="mono">${slug}.md</span>
  </nav>
</div>

<header class="hero">
  <div class="wrap">
    <span class="eyebrow"><span class="dot"></span>${badgeLabel}</span>
    <h1>${escape(title)}</h1>
    <p class="lede" style="margin:0;font-size:13.5px;color:var(--ink-3);font-family:var(--mono)">
      Autogenerado · source: <code>${kind === 'spec' ? 'specs' : 'plans'}/${slug}.md</code>
    </p>
  </div>
</header>

${tocHtml}

<main>
  <div class="wrap">
${progressBtn}
    ${body}
  </div>
</main>

<footer class="foot">
  <div class="wrap">
    <p>HTML autogenerado · NO edites este archivo. Modifica el <code>.md</code> y re-genera con:</p>
    <pre><code class="language-sql">node scripts/docs-md-to-html.mjs docs/superpowers/${kind === 'spec' ? 'specs' : 'plans'}/${slug}.md</code></pre>
    <p>Reglas en <code>docs/CLAUDE.md</code> sección "MD → HTML autogenerado".</p>
  </div>
</footer>

<div class="toast" id="toast"></div>
${taskScript}
</body>
</html>
`;
}

/** Mini escape para texto en attributes/title */
function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Procesa un .md → escribe el .html al lado. */
async function processFile(absPath, check = false) {
  const { kind } = classify(absPath);
  if (!kind) {
    if (process.env.VERBOSE) console.error(`[skip] no es spec/plan: ${absPath}`);
    return { processed: false, path: absPath };
  }

  let md;
  try {
    md = await fs.readFile(absPath, 'utf8');
  } catch (e) {
    console.error(`[err] no se pudo leer ${absPath}: ${e.message}`);
    return { processed: false, path: absPath, error: e.message };
  }

  const title = extractTitle(md);
  const body = markdownToHtml(md);
  const toc = extractToc(md);
  const base = path.basename(absPath, '.md');
  const outPath = path.join(path.dirname(absPath), `${base}.html`);
  const html = buildHtml({ kind, title, body, toc, slug: base });

  if (check) {
    let existing;
    try { existing = await fs.readFile(outPath, 'utf8'); } catch { existing = null; }
    if (existing !== html) throw new Error(`HTML missing or stale: ${outPath}`);
  } else await fs.writeFile(outPath, html, 'utf8');
  return { processed: true, path: absPath, out: outPath };
}

/** Lista todos los .md de specs/ y plans/ */
async function listAll() {
  const out = [];
  for (const dir of [SPECS_DIR, PLANS_DIR]) {
    try {
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (f.endsWith('.md')) out.push(path.join(dir, f));
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return out;
}

/** Main */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('usage: node scripts/docs-md-to-html.mjs <path.md> [...]');
    console.error('       node scripts/docs-md-to-html.mjs --all');
    process.exit(1);
  }

  let targets;
  if (args.includes('--all') || args.includes('--missing')) {
    targets = await listAll();
    if (args.includes('--missing')) { const missing=[]; for(const t of targets) { try { await fs.access(t.slice(0,-3)+'.html'); } catch { missing.push(t); } } targets=missing; }
    console.error(`[backfill] procesando ${targets.length} archivos…`);
  } else {
    targets = args.filter(p => p !== '--check').map(p => path.resolve(process.cwd(), p));
    if (!targets.length) throw new Error('Specify files or --all with --check');
  }

  let processed = 0, skipped = 0, errors = 0;
  for (const t of targets) {
    try {
      const r = await processFile(t, args.includes('--check'));
      if (r.processed) {
        processed++;
        if (process.env.VERBOSE || targets.length === 1) {
          console.error(`[ok] ${path.relative(REPO_ROOT, r.out)}`);
        }
      } else {
        if (r.error) errors++; else skipped++;
      }
    } catch (e) {
      errors++;
      console.error(`[err] ${t}: ${e.message}`);
    }
  }

  console.error(`done · processed=${processed} skipped=${skipped} errors=${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
