import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appTree, packageCount } from '../app-tree.mjs';

const lock = (packages) => ({ packages });

test('the app resolves its own copy before the root, and what that copy needs from beside it', () => {
  const tree = appTree(
    lock({
      'apps/mobile': { name: 'app', version: '1.0.0', dependencies: { wallet: '1.0.0' } },
      'apps/mobile/node_modules/wallet': { version: '1.0.0', peerDependencies: { signer: '*' } },
      'apps/mobile/node_modules/signer': { version: '2.55.0' },
      'node_modules/wallet': { version: '1.0.0', peerDependencies: { signer: '*' } },
      'node_modules/signer': { version: '2.56.0' },
    }),
  );
  assert.deepEqual(tree, ['app@1.0.0 -> wallet@1.0.0', 'wallet@1.0.0 -> signer@2.55.0']);
  assert.equal(packageCount(tree), 2);
});

test('a copy hoisted to the root changes what the app signs with, and the tree shows it', () => {
  const tree = appTree(
    lock({
      'apps/mobile': { name: 'app', version: '1.0.0', dependencies: { wallet: '1.0.0' } },
      'apps/mobile/node_modules/signer': { version: '2.55.0' },
      'node_modules/wallet': { version: '1.0.0', peerDependencies: { signer: '*' } },
      'node_modules/signer': { version: '2.56.0' },
    }),
  );
  assert.deepEqual(tree, ['app@1.0.0 -> wallet@1.0.0', 'wallet@1.0.0 -> signer@2.56.0']);
});

test('a workspace package is followed to where it lives, with its own dependencies', () => {
  const tree = appTree(
    lock({
      'apps/mobile': {
        name: 'app',
        version: '1.0.0',
        dependencies: { '@pickler/rule': '*' },
        devDependencies: { jest: '29' },
      },
      'node_modules/@pickler/rule': { resolved: 'packages/rule', link: true },
      'packages/rule': { name: '@pickler/rule', version: '0.0.0', dependencies: { hd: '2.3.0' } },
      'packages/rule/node_modules/hd': { version: '2.3.0' },
      'node_modules/hd': { version: '1.7.0' },
      'node_modules/jest': { version: '29.7.0' },
    }),
  );
  assert.deepEqual(tree, [
    '@pickler/rule@0.0.0 -> hd@2.3.0',
    'app@1.0.0 -> @pickler/rule@0.0.0',
    'app@1.0.0 -> jest@29.7.0',
  ]);
});

test('a dependency re-pointed to another version already in the tree is a difference', () => {
  const packages = {
    'apps/mobile': { name: 'app', version: '1.0.0', dependencies: { wallet: '1.0.0', curves: '1.9.0' } },
    'apps/mobile/node_modules/wallet': { version: '1.0.0', dependencies: { curves: '2.0.0' } },
    'apps/mobile/node_modules/wallet/node_modules/curves': { version: '2.0.0' },
    'apps/mobile/node_modules/curves': { version: '1.9.0' },
    'apps/mobile/node_modules/other': { version: '1.0.0' },
  };
  const before = appTree(lock(packages));

  // The wallet's own copy is gone: it now computes with the app's older one. Both versions are
  // still in the tree, so a list of packages would not have moved.
  delete packages['apps/mobile/node_modules/wallet/node_modules/curves'];
  packages['apps/mobile'].dependencies.keeps = '1.0.0';
  packages['apps/mobile/node_modules/keeps'] = { version: '1.0.0', dependencies: { curves: '2.0.0' } };
  packages['apps/mobile/node_modules/keeps/node_modules/curves'] = { version: '2.0.0' };
  const after = appTree(lock(packages));

  assert.ok(before.includes('wallet@1.0.0 -> curves@2.0.0'));
  assert.ok(after.includes('wallet@1.0.0 -> curves@1.9.0'));
  assert.ok(!after.includes('wallet@1.0.0 -> curves@2.0.0'));
});
