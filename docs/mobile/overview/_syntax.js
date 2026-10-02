/* =============================================================================
 * Pickler · Design Docs · _syntax.js
 *
 * Highlighter standalone para snippets en project overviews. Sin deps, sin CDN.
 * Activa <pre><code class="language-X">…</code></pre> con X ∈ { ts, sql, json }.
 *
 * Uso:
 *   <link rel="stylesheet" href="_styles.css">   ← tokens definidos ahí
 *   <script defer src="_syntax.js"></script>
 *   <pre><code class="language-ts">const x: number = 1;</code></pre>
 *
 * El script corre auto al cargar (DOMContentLoaded) y reescribe cada bloque
 * encontrado. Si necesitas re-highlightear dinámicamente, llama a
 * window.Syntax.highlightAll() o window.Syntax.highlightElement(node).
 *
 * Reglas de diseño:
 * - Construcción de DOM segura: usa createElement/createTextNode (no innerHTML).
 * - Patrón "token stream": cada lenguaje produce [{type, value}] y un único
 *   renderer común crea los <span class="token X">.
 * - Idempotente: si un <code> ya tiene data-highlighted="true", se salta.
 * - Regex ancladas al inicio (^) — se aplican a remaining slice del código.
 * ============================================================================= */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Gramáticas por lenguaje. Regex ancladas con ^ — el tokenizer las aplica
  // sobre slices del remaining input. El orden importa: primer match gana.
  // ---------------------------------------------------------------------------

  const LANGS = {
    ts: {
      grammar: [
        ['comment',     /^\/\/[^\n]*|^\/\*[\s\S]*?\*\//],
        ['string',      /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/],
        ['regex',       /^\/(?:\\.|[^\/\\\n])+\/[gimsuy]*(?=[\s;,)\]]|$)/],
        ['number',      /^\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/],
        ['keyword',     /^\b(?:abstract|any|as|async|await|boolean|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|namespace|new|null|number|of|private|protected|public|readonly|return|set|static|string|super|switch|this|throw|true|try|type|typeof|undefined|unknown|var|void|while|with|yield|never|satisfies|infer)\b/],
        ['boolean',     /^\b(?:true|false|null|undefined)\b/],
        ['classname',   /^\b[A-Z][A-Za-z0-9_]*\b/],
        ['function',    /^\b[a-zA-Z_$][\w$]*(?=\s*\()/],
        ['property',    /^(?<=\.)[a-zA-Z_$][\w$]*/],
        ['operator',    /^(?:[+\-*/%=<>!&|^~?:]+|\.{3}|=>)/],
        ['punctuation', /^[{}[\](),;.]/],
        ['identifier',  /^[a-zA-Z_$][\w$]*/],
        ['whitespace',  /^\s+/],
      ],
    },

    sql: {
      grammar: [
        ['comment',     /^--[^\n]*|^\/\*[\s\S]*?\*\//],
        ['string',      /^'(?:''|[^'])*'/],
        ['number',      /^\b\d+(?:\.\d+)?\b/],
        ['keyword',     /^\b(?:SELECT|FROM|WHERE|AND|OR|NOT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|UNIQUE|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|CHECK|DEFAULT|NULL|IS|IN|EXISTS|ANY|ALL|JOIN|INNER|LEFT|RIGHT|OUTER|ON|USING|GROUP|BY|HAVING|ORDER|ASC|DESC|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|AS|DISTINCT|CASE|WHEN|THEN|ELSE|END|WITH|RECURSIVE|RETURNING|DROP|ALTER|ADD|COLUMN|RENAME|TO|TYPE|ENUM|GRANT|REVOKE|ROLE|SCHEMA|EXTENSION|FUNCTION|PROCEDURE|RETURNS|LANGUAGE|TRIGGER|BEFORE|AFTER|EACH|ROW|VIEW|MATERIALIZED|REFRESH|ANALYZE|EXPLAIN|VACUUM|TRUNCATE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|TRANSACTION|ISOLATION|LEVEL)\b/i],
        ['type',        /^\b(?:INT|INTEGER|BIGINT|SMALLINT|SERIAL|BIGSERIAL|TEXT|VARCHAR|CHAR|BOOLEAN|BOOL|DATE|TIMESTAMP|TIMESTAMPTZ|TIME|INTERVAL|NUMERIC|DECIMAL|REAL|DOUBLE|PRECISION|UUID|JSON|JSONB|BYTEA|MONEY|ARRAY)\b/i],
        ['boolean',     /^\b(?:TRUE|FALSE|NULL)\b/i],
        ['function',    /^\b[a-zA-Z_][\w]*(?=\s*\()/],
        ['identifier',  /^(?:"[^"]+"|`[^`]+`|[a-zA-Z_][\w]*)/],
        ['operator',    /^(?:[+\-*/%=<>!]+|\|\||::)/],
        ['punctuation', /^[(),;.]/],
        ['whitespace',  /^\s+/],
      ],
    },

    json: {
      grammar: [
        ['comment',     /^\/\/[^\n]*|^\/\*[\s\S]*?\*\//],
        ['property',    /^"[^"]*"(?=\s*:)/],
        ['string',      /^"(?:\\.|[^"\\])*"/],
        ['number',      /^-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
        ['boolean',     /^\b(?:true|false|null)\b/],
        ['punctuation', /^[{}[\],:]/],
        ['whitespace',  /^\s+/],
      ],
    },
  };

  // ---------------------------------------------------------------------------
  // Token stream: avanza por el remaining slice, prueba cada regla en orden,
  // emite tokens. Lo no-matcheado → 'text' (defensa contra regex incompleta).
  // ---------------------------------------------------------------------------

  function tokenize(code, grammar) {
    const tokens = [];
    let pos = 0;
    const len = code.length;

    while (pos < len) {
      const remaining = code.slice(pos);
      let matched = false;
      for (const [type, rx] of grammar) {
        const m = remaining.match(rx);
        if (m && m.index === 0) {
          tokens.push({ type, value: m[0] });
          pos += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        tokens.push({ type: 'text', value: code[pos] });
        pos += 1;
      }
    }
    return tokens;
  }

  // ---------------------------------------------------------------------------
  // Renderer: token stream → DocumentFragment con <span class="token X"> por
  // token (whitespace / text / identifier se emiten como text nodes simples).
  // ---------------------------------------------------------------------------

  function render(tokens) {
    const frag = document.createDocumentFragment();
    for (const t of tokens) {
      if (t.type === 'whitespace' || t.type === 'text' || t.type === 'identifier') {
        frag.appendChild(document.createTextNode(t.value));
      } else {
        const span = document.createElement('span');
        span.className = `token ${t.type}`;
        span.textContent = t.value;
        frag.appendChild(span);
      }
    }
    return frag;
  }

  // ---------------------------------------------------------------------------
  // Pública: highlightElement(node) y highlightAll(root?).
  // ---------------------------------------------------------------------------

  function highlightElement(node) {
    if (!node || node.dataset.highlighted === 'true') return;
    const cls = (node.getAttribute('class') || '').match(/language-(\w+)/);
    if (!cls) return;
    const lang = LANGS[cls[1]];
    if (!lang) return;

    const code = node.textContent;
    const tokens = tokenize(code, lang.grammar);
    const frag = render(tokens);

    node.textContent = '';
    node.appendChild(frag);
    node.dataset.highlighted = 'true';
  }

  function highlightAll(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll('pre code[class*="language-"]');
    nodes.forEach(highlightElement);
  }

  // Expose
  window.Syntax = { highlightAll, highlightElement };

  // Auto-run en DOMContentLoaded (con guard si el script carga tardío)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { highlightAll(); });
  } else {
    highlightAll();
  }
})();
