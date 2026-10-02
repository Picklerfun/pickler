// Sin tipos de Node en la app (no es un entorno Node): lo justo de `fs` y `path`, tipado a mano.
declare const __dirname: string;
type Entry = { name: string; isDirectory(): boolean };
const { readdirSync, readFileSync } = require("fs") as {
  readdirSync: (dir: string, opts: { withFileTypes: true }) => Entry[];
  readFileSync: (file: string, encoding: "utf8") => string;
};
const { join } = require("path") as { join: (...parts: string[]) => string };

// Las suites de la app son de lógica pura: ninguna monta `App` ni las pantallas, así que un hook llamado después de un
// `return` temprano —que hace reventar a React al segundo render («Rendered more hooks…»)— pasa typecheck y Jest sin
// ruido, y el lint del monorepo no mira esta carpeta. Pasó una vez, en App.tsx. Esto lee el código y lo impide: en cada
// componente, ninguna llamada a un hook puede venir después de un `return` a nivel del cuerpo.

const ROOT = join(__dirname, "..");
const sources = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.tsx$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );

/** Líneas de hooks que quedan después de un `return` temprano dentro del mismo componente. */
function hooksAfterEarlyReturn(code: string): string[] {
  const found: string[] = [];
  const lines = code.split("\n");
  let component: { indent: string; returned: boolean } | null = null;
  for (const [index, line] of lines.entries()) {
    const start = /^(\s*)(?:export\s+)?(?:default\s+)?function\s+[A-Z]\w*\s*\(/.exec(line);
    if (start) { component = { indent: start[1]!, returned: false }; continue; }
    if (!component) continue;
    if (line === `${component.indent}}`) { component = null; continue; }
    // Sólo el cuerpo del componente: dos espacios más que su `function`. Lo anidado (callbacks, efectos) no cuenta.
    const body = `${component.indent}  `;
    if (!line.startsWith(body) || line.startsWith(`${body} `)) continue;
    const statement = line.slice(body.length);
    if (component.returned && /\buse[A-Z]\w*\s*(<[^>]*>)?\(/.test(statement)) found.push(`${index + 1}: ${statement.trim()}`);
    // Un `return` condicional de una línea, o un bloque `if (...) {` cuyo cuerpo retorna, cortan el render antes de tiempo.
    if (/^if\s*\(.*\)\s*return\b/.test(statement)) component.returned = true;
    if (/^if\s*\(.*\)\s*\{\s*$/.test(statement) && /^\s*return\b/.test(lines[index + 1] ?? "")) component.returned = true;
  }
  return found;
}

test("the check itself sees a hook after an early return, and not one before it", () => {
  const bad = ["export function Screen() {", "  const a = useState(0);", "  if (!a) return null;", "  const b = useRef(0);", "  return b;", "}"].join("\n");
  const good = ["export function Screen() {", "  const a = useState(0);", "  const b = useRef(0);", "  if (!a) return null;", "  useEffect(() => { if (b) return; }, []);".replace("useEffect", "void"), "  return b;", "}"].join("\n");
  expect(hooksAfterEarlyReturn(bad)).toEqual(["4: const b = useRef(0);"]);
  expect(hooksAfterEarlyReturn(good)).toEqual([]);
});

test("no component calls a hook after an early return", () => {
  const offenders = ["App.tsx", ...sources("src")].flatMap((file) =>
    hooksAfterEarlyReturn(readFileSync(join(ROOT, file), "utf8")).map((hit) => `${file}:${hit}`),
  );
  expect(offenders).toEqual([]);
});
