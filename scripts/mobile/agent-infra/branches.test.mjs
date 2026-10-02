import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyBranch, inventory } from './branches.mjs';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-branches-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  const commit = (file, value) => {
    writeFileSync(join(dir, file), value);
    git('add', '--', file);
    git('commit', '-m', 'fixture');
  };
  commit('code.txt', 'initial\n');
  return { dir, git, commit };
}
test('docs-only work is never classified as integrated', (t) => {
  const { dir, git, commit } = fixture(t);
  git('checkout', '-b', 'docs');
  mkdirSync(join(dir, 'docs'));
  commit('docs/new.md', 'pending');
  assert.equal(classifyBranch(dir, 'main', 'docs').status, 'unknown_review');
});
test('squash followed by main changes stays uncertain, never lost work', (t) => {
  const { dir, git, commit } = fixture(t);
  git('checkout', '-b', 'feature');
  commit('code.txt', 'feature\n');
  commit('extra.txt', 'extra');
  git('checkout', 'main');
  git('merge', '--squash', 'feature');
  git('commit', '-m', 'squash');
  commit('code.txt', 'later main change\n');
  assert.equal(classifyBranch(dir, 'main', 'feature').status, 'unknown_review');
});
test('ancestry is proven; unknown baseline fails instead of empty inventory', (t) => {
  const { dir, git } = fixture(t);
  git('branch', 'merged');
  assert.equal(
    classifyBranch(dir, 'main', 'merged').status,
    'integrated_ancestry',
  );
  assert.throws(() => inventory(dir, 'missing'));
  writeFileSync(join(dir, 'code.txt'), 'unstaged change');
  assert.equal(inventory(dir, 'main').worktrees[0].changes[0], ' M code.txt');
  assert.equal(
    inventory(dir, 'main').worktrees[0].path,
    dir.replace(/^\/var\//, '/private/var/'),
  );
});
