import {
  readFileSync,
  readdirSync,
  existsSync,
  lstatSync,
  readlinkSync,
} from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import YAML from 'yaml';
const HERE = dirname(fileURLToPath(import.meta.url));
export function skillMetadata(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('Missing YAML frontmatter');
  const doc = YAML.parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length)
    throw new Error(doc.errors.map((e) => e.message).join('; '));
  const data = doc.toJS();
  if (
    typeof data?.name !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) ||
    data.name.length > 64
  )
    throw new Error('Invalid skill name');
  if (
    typeof data.description !== 'string' ||
    !data.description.trim() ||
    data.description.length > 1024
  )
    throw new Error('Invalid skill description');
  return data; // Preserve vendor compatibility/metadata/allowed-tools; these are not permissions.
}
export function htmlFacts(sources) {
  return JSON.parse(
    execFileSync('python3', [join(HERE, 'html-facts.py')], {
      input: JSON.stringify(sources),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}
export function manifest(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { timeout: 1000 });
  const docs = context.window.DOCS;
  if (
    !Array.isArray(docs) ||
    Object.keys(docs).length !== docs.length ||
    docs.some((d) => !d?.file)
  )
    throw new Error('Invalid or sparse manifest');
  if (new Set(docs.map((d) => d.file)).size !== docs.length)
    throw new Error('Duplicate manifest file');
  return docs;
}
export function comparePhases(expected, actual) {
  const normalize = (p) =>
    p
      .map((x) => [String(x.num), x.status])
      .sort((a, b) => a[0].localeCompare(b[0]));
  if (new Set(actual.map((p) => p.num)).size !== actual.length) return false;
  return (
    JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual))
  );
}
export function walk(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((d) => {
    const p = join(root, d.name);
    if (d.isSymbolicLink()) return [p];
    return d.isDirectory() ? walk(p) : [p];
  });
}
export function check(root) {
  const errors = [];
  const fail = (p, message) => errors.push(`${relative(root, p)}: ${message}`);
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
    .split('\0')
    .filter(Boolean);
  const instructions = [...new Set(files)].filter((f) =>
    /(^|\/)AGENTS\.md$/.test(f),
  );
  let maxChain = { bytes: 0, path: '' };
  for (const f of instructions) {
    const p = join(root, f);
    if (!existsSync(p)) {
      fail(p, 'broken instruction link');
      continue;
    }
    if (
      f !== 'apps/mobile/AGENTS.md' &&
      (!lstatSync(p).isSymbolicLink() || readlinkSync(p) !== 'CLAUDE.md')
    )
      fail(p, 'AGENTS must link to sibling CLAUDE.md');
    let dir = dirname(p),
      bytes = 0;
    while (dir.startsWith(root)) {
      const q = join(dir, 'AGENTS.md');
      if (existsSync(q)) bytes += Buffer.byteLength(readFileSync(q));
      if (dir === root) break;
      dir = dirname(dir);
    }
    if (bytes > maxChain.bytes) maxChain = { bytes, path: f };
    if (bytes > 24 * 1024)
      fail(p, `instruction chain ${bytes} exceeds 24576 bytes`);
  }
  for (const f of files.filter((f) => /(^|\/)CLAUDE\.md$/.test(f))) {
    if (!existsSync(join(root, dirname(f), 'AGENTS.md')))
      fail(join(root, f), 'missing AGENTS twin');
  }
  const mobileAdapter = join(root, 'apps/mobile/CLAUDE.md');
  if (
    existsSync(mobileAdapter) &&
    readFileSync(mobileAdapter, 'utf8').trim() !== '@AGENTS.md'
  )
    fail(mobileAdapter, 'mobile adapter must import its real AGENTS.md');
  for (const f of files.filter((f) => /^\.claude\/skills\/[^/]+$/.test(f))) {
    if (!existsSync(join(root, f)))
      fail(join(root, f), 'missing skill discovery entry');
  }
  for (const p of walk(join(root, '.claude/skills'))) {
    if (lstatSync(p).isSymbolicLink() && !existsSync(p))
      fail(p, 'broken skill discovery link');
  }
  for (const f of instructions) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(
      /\[[^\]]*\]\(([^\s)]+)\)/g,
    )) {
      const link = m[1];
      if (
        !/^(?:[a-z]+:|#|\/)/i.test(link) &&
        !existsSync(resolve(dirname(p), decodeURIComponent(link.split('#')[0])))
      )
        fail(p, `missing instruction reference ${link}`);
    }
  }
  const skills = walk(join(root, '.agents/skills')).filter((f) =>
    f.endsWith('/SKILL.md'),
  );
  for (const p of skills) {
    try {
      const s = readFileSync(p, 'utf8'),
        meta = skillMetadata(s);
      if (meta.name !== p.split('/').at(-2))
        fail(p, 'name does not match directory');
      if (Buffer.byteLength(s) > 16000)
        fail(p, 'entry exceeds 16 KB; extract procedures');
      for (const m of s.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
        const link = m[1];
        if (
          !/^(?:[a-z]+:|#|\/)/i.test(link) &&
          !existsSync(
            resolve(dirname(p), decodeURIComponent(link.split('#')[0])),
          )
        )
          fail(p, `missing reference ${link}`);
      }
    } catch (e) {
      fail(p, e.message);
    }
  }
  const overview = join(root, 'docs/overview'),
    docs = manifest(readFileSync(join(overview, 'data/manifest.js'), 'utf8'));
  const existing = docs.filter((d) => existsSync(join(overview, d.file)));
  for (const d of docs)
    if (!existsSync(join(overview, d.file)))
      fail(join(overview, d.file), 'manifest target missing');
  const facts = htmlFacts(
    existing.map((d) => readFileSync(join(overview, d.file), 'utf8')),
  );
  let comparable = 0;
  existing.forEach((d, i) => {
    if (d.phases?.length) {
      comparable++;
      if (!comparePhases(d.phases, facts[i].phases))
        fail(join(overview, d.file), 'phase IDs/status differ from manifest');
    }
  });
  let mdCount = 0;
  for (const area of ['specs', 'plans'])
    for (const p of walk(join(root, 'docs/superpowers', area)).filter(
      (p) =>
        p.endsWith('.md') &&
        dirname(p) === join(root, 'docs/superpowers', area),
    )) {
      mdCount++;
      if (!existsSync(p.slice(0, -3) + '.html'))
        fail(p, 'generated HTML missing');
    }
  return {
    errors,
    metrics: {
      instructions: instructions.length,
      skills: skills.length,
      manifest: docs.length,
      comparable,
      mdCount,
      maxChain,
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = check(resolve(process.argv[2] || join(HERE, '../..')));
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
