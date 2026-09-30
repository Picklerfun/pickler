// The static check's rules, each against a file that breaks it and a file that does not. The
// fixtures are real files rather than strings so that what is tested is what the check reads: a
// whole stylesheet with comments, continued values and selectors in it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkCss,
  checkTs,
  declarations,
  definedTokens,
  readClasses,
  unusedClasses,
} from "./lib/source-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, "fixtures/source", name), "utf8");
const tokens = definedTokens(fixture("tokens.css"));

const css = (name, isTokenFile = false) => checkCss(name, fixture(name), { tokens, isTokenFile });
const typescript = (name, as = name) =>
  checkTs(as, fixture(name), {
    tokens,
    mirror: "packages/ui/src/tokens.ts",
    marks: ["packages/ui/src/brand.tsx"],
    channel: "apps/web/src/lib/accent.ts",
  });
const rules = (problems) => problems.map((problem) => `${problem.rule}:${problem.line}`);

test("the token file's definitions are found on every selector, and a comment defines nothing", () => {
  assert.deepEqual([...tokens].sort(), ["--pk-font", "--pk-ink", "--pk-lime", "--pk-rule"]);
});

test("a value continued over several lines is one declaration, at its property's line", () => {
  const found = declarations(fixture("colour-literal.fail.module.css"));
  const shadow = found.find((one) => one.property === "box-shadow" && one.line === 26);

  assert.equal(shadow?.value, "inset 0 1px 0 var(--pk-rule), 0 0 24px rgba(200, 240, 58, 0.32)");
});

test("colour literal: tokens, keywords and names that are not colours pass", () => {
  assert.deepEqual(css("colour-literal.pass.module.css"), []);
});

test("colour literal: hex, rgb, a triple in rgba, hsl, a named colour and a continued value fail", () => {
  assert.deepEqual(rules(css("colour-literal.fail.module.css")), [
    "colour-literal:2",
    "colour-literal:6",
    "colour-literal:10",
    "colour-literal:14",
    "colour-literal:18",
    "colour-literal:22",
    "colour-literal:26",
  ]);
});

test("colour literal: the token file may hold one in a definition", () => {
  assert.deepEqual(css("token-file.pass.css", true), []);
});

test("colour literal: the token file may not hold one in a rule", () => {
  assert.deepEqual(rules(css("token-file.fail.css", true)), ["colour-literal:7"]);
});

test("token definition: a module's own local values pass", () => {
  assert.deepEqual(css("token-definition.pass.module.css"), []);
});

test("token definition: --pk-* outside the token file fails", () => {
  assert.deepEqual(rules(css("token-definition.fail.module.css")), [
    "token-definition:2",
    "token-alias:2",
  ]);
});

test("token alias: a computed local value that reads a token passes", () => {
  assert.deepEqual(css("token-alias.pass.module.css"), []);
});

test("token alias: a property whose whole value is one token fails, per variant too", () => {
  assert.deepEqual(rules(css("token-alias.fail.module.css")), [
    "token-alias:2",
    "token-alias:3",
    "token-alias:7",
  ]);
});

test("undefined token: every token read is defined", () => {
  assert.deepEqual(css("undefined-token.pass.module.css"), []);
});

test("undefined token: a read with a fallback is still a read of something undefined", () => {
  assert.deepEqual(rules(css("undefined-token.fail.module.css")), [
    "undefined-token:2",
    "undefined-token:3",
  ]);
});

test("colour in TypeScript: anchors, selectors, comments and prose pass", () => {
  assert.deepEqual(typescript("colour-in-ts.pass.tsx"), []);
});

test("colour in TypeScript: hex and rgb() in strings, templates and JSX attributes fail", () => {
  assert.deepEqual(rules(typescript("colour-in-ts.fail.tsx")), [
    "colour-in-ts:1",
    "colour-in-ts:2",
    "colour-in-ts:3",
    "colour-in-ts:6",
  ]);
});

test("colour in TypeScript: the mirror and the third-party marks are the two exemptions", () => {
  assert.deepEqual(typescript("colour-in-ts.fail.tsx", "packages/ui/src/tokens.ts"), []);
  assert.deepEqual(typescript("colour-in-ts.fail.tsx", "packages/ui/src/brand.tsx"), []);
});

test("third-party mark: a selector, a comment and other data attributes pass", () => {
  assert.deepEqual(typescript("third-party-mark.pass.tsx"), []);
});

test("third-party mark: the attribute, a spread key and a setAttribute fail outside MARKS", () => {
  assert.deepEqual(rules(typescript("third-party-mark.fail.tsx")), [
    "third-party-mark:2",
    "third-party-mark:5",
    "third-party-mark:8",
  ]);
});

test("third-party mark: a file in MARKS may carry it", () => {
  assert.deepEqual(typescript("third-party-mark.fail.tsx", "packages/ui/src/brand.tsx"), []);
});

test("tokens in TypeScript: reading one by name, a local index and a template family pass", () => {
  assert.deepEqual(typescript("token-ts.pass.ts"), []);
});

test("tokens in TypeScript: an alias, a definition and an undefined name fail", () => {
  assert.deepEqual(rules(typescript("token-ts.fail.ts")), [
    "token-alias:1",
    "token-definition:2",
    "undefined-token:3",
  ]);
});

test("tokens in TypeScript: the mirror may key its values by the token each one copies", () => {
  assert.deepEqual(typescript("token-mirror.pass.ts", "packages/ui/src/tokens.ts"), []);
});

test("tokens in TypeScript: the same keys anywhere else are definitions", () => {
  assert.deepEqual(rules(typescript("token-mirror.pass.ts")), [
    "colour-in-ts:3",
    "token-definition:3",
    "colour-in-ts:4",
    "token-definition:4",
  ]);
});

test("tokens in TypeScript: the accent channel may hand a token to CSS", () => {
  const found = typescript("token-ts.fail.ts", "apps/web/src/lib/accent.ts");

  assert.deepEqual(rules(found), ["undefined-token:3"]);
});

test("unused class: named, quoted, composed and kept classes pass; the rest are reported", () => {
  const used = readClasses(fixture("unused-class.reader.tsx"), "styles");
  const found = unusedClasses("unused-class.module.css", fixture("unused-class.module.css"), used, [
    "resultWon",
  ]);

  assert.deepEqual(
    found.map((problem) => `${problem.text.split(" ")[0]}:${problem.line}`),
    [".orphan:21", ".ghost:30"],
  );
});

test("unused class: without the keep list a computed access is reported", () => {
  const used = readClasses(fixture("unused-class.reader.tsx"), "styles");
  const found = unusedClasses(
    "unused-class.module.css",
    fixture("unused-class.module.css"),
    used,
    [],
  );

  assert.equal(
    found.some((problem) => problem.text.startsWith(".resultWon")),
    true,
  );
});

/* The command itself, over a tree built for the test: report-only exits 0 on a violation and
 * --strict exits 1 on the same one, and a clean tree exits 0 either way. */
function tree(moduleCss) {
  const root = mkdtempSync(path.join(tmpdir(), "design-source-"));
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  write("packages/ui/src/styles.css", fixture("tokens.css"));
  write("apps/web/src/features/x/x.module.css", moduleCss);
  write(
    "apps/web/src/features/x/x.tsx",
    'import styles from "./x.module.css";\nexport const name = styles.card;\n',
  );
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  return root;
}

function run(root, ...flags) {
  return spawnSync(process.execPath, [path.join(HERE, "source.mjs"), ...flags], {
    encoding: "utf8",
    env: { ...process.env, DESIGN_SOURCE_ROOT: root },
  });
}

test("the command reports and exits 0, and --strict exits 1 on the same tree", () => {
  const root = tree(".card {\n  color: #c8f03a;\n}\n");
  try {
    const report = run(root);
    const strict = run(root, "--strict");

    assert.equal(report.status, 0);
    assert.match(
      report.stdout,
      /note {2}colour-literal {2}apps\/web\/src\/features\/x\/x\.module\.css:2/,
    );
    assert.match(report.stdout, /source: 1 violation\(s\)/);
    assert.equal(strict.status, 1);
    assert.match(strict.stdout, /FAIL {2}colour-literal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the command exits 0 under --strict on a clean tree", () => {
  const root = tree(".card {\n  color: var(--pk-ink);\n}\n");
  try {
    const strict = run(root, "--strict");

    assert.equal(strict.status, 0);
    assert.match(strict.stdout, /source: clean over 3 file\(s\)\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
