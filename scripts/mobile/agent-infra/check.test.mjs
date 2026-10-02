import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillMetadata, manifest, htmlFacts, comparePhases } from './check.mjs';
test('rejects the actual unquoted colon defect; accepts quoted metadata and compatibility', () => {
  assert.throws(() =>
    skillMetadata(
      '---\nname: dev\ndescription: Adds entry with types: [fix]\n---\n',
    ),
  );
  assert.equal(
    skillMetadata(
      '---\nname: dev\ndescription: "Adds entry with types: [fix]"\ncompatibility: codex,claude-code\n---\n',
    ).name,
    'dev',
  );
  assert.throws(() =>
    skillMetadata('---\nname: dev\nname: other\ndescription: hello\n---\n'),
  );
});
test('rejects sparse/duplicate manifests', () => {
  assert.throws(() => manifest('window.DOCS=[{file:"a"},,{file:"b"}];'));
  assert.throws(() => manifest('window.DOCS=[{file:"a"},{file:"a"}];'));
  assert.equal(manifest('window.DOCS=[{file:"a"}];').length, 1);
});
test('HTML parser ignores script examples and handles nonnumeric phases', () => {
  const [r] = htmlFacts([
    '<article data-status="completed" class="extra phase-card" data-phase="2a"></article><script>const s=`<article class="phase-card" data-phase="fake">`;</script><!-- <article class="phase-card"> -->',
  ]);
  assert.equal(r.phases.length, 1);
  assert.equal(
    comparePhases([{ num: '2a', status: 'completed' }], r.phases),
    true,
  );
  assert.equal(
    comparePhases([{ num: '2a', status: 'pending' }], r.phases),
    false,
  );
  assert.equal(
    comparePhases([{ num: 2, status: 'completed' }], r.phases),
    false,
  );
});

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { check } from './check.mjs';
test('repository audit detects broken links, oversize chains and missing generated views', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agent-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  function put(path, value) {
    const p = join(root, path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, value);
  }
  put('CLAUDE.md', '# Root');
  symlinkSync('CLAUDE.md', join(root, 'AGENTS.md'));
  put(
    '.agents/skills/demo/SKILL.md',
    '---\nname: demo\ndescription: Valid example\n---\n',
  );
  put(
    'docs/overview/data/manifest.js',
    'window.DOCS=[{file:"demo.html",phases:[{num:0,status:"pending"}]}];',
  );
  put(
    'docs/overview/demo.html',
    '<article class="phase-card" data-phase="0" data-status="pending"></article>',
  );
  put('docs/superpowers/specs/example.md', '# Example');
  put('docs/superpowers/specs/example.html', '<h1>Example</h1>');
  assert.deepEqual(check(root).errors, []);
  put('docs/overview/demo.html', '<p>Cards accidentally removed</p>');
  assert.ok(check(root).errors.some((e) => e.includes('phase IDs/status')));
  put(
    'docs/overview/demo.html',
    '<article class="phase-card" data-phase="0" data-status="pending"></article>',
  );
  put('CLAUDE.md', 'x'.repeat(24577));
  assert.ok(check(root).errors.some((e) => e.includes('exceeds 24576')));
  put('CLAUDE.md', '# Root');
  unlinkSync(join(root, 'docs/superpowers/specs/example.html'));
  assert.ok(check(root).errors.some((e) => e.includes('HTML missing')));
  unlinkSync(join(root, 'CLAUDE.md'));
  assert.ok(
    check(root).errors.some((e) => e.includes('broken instruction link')),
  );
});
