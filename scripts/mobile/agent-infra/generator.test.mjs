import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
test('HTML check rejects missing/stale views without writing and accepts regenerated content', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'doc-view-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'docs/superpowers/specs');
  mkdirSync(dir, { recursive: true });
  const md = join(dir, 'demo.md'),
    html = md.slice(0, -3) + '.html';
  writeFileSync(md, '# First\n\nOriginal.');
  const run = (...args) =>
    execFileSync(
      process.execPath,
      [resolve('scripts/docs-md-to-html.mjs'), ...args, md],
      { stdio: 'pipe' },
    );
  assert.throws(() => run('--check'));
  run();
  run('--check');
  const before = readFileSync(html, 'utf8');
  writeFileSync(md, '# Changed\n\nNew contract.');
  assert.throws(() => run('--check'));
  assert.equal(readFileSync(html, 'utf8'), before);
  run();
  run('--check');
});
