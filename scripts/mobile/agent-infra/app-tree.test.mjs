import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appTree } from '../app-tree.mjs';

const lock = (packages) => ({ packages });

test('the app resolves its own copy before the root, and what that copy needs from beside it', () => {
  const tree = appTree(
    lock({
      'apps/mobile': { dependencies: { wallet: '1.0.0' } },
      'apps/mobile/node_modules/wallet': { version: '1.0.0', peerDependencies: { signer: '*' } },
      'apps/mobile/node_modules/signer': { version: '2.55.0' },
      'node_modules/wallet': { version: '1.0.0', peerDependencies: { signer: '*' } },
      'node_modules/signer': { version: '2.56.0' },
    }),
  );
  assert.deepEqual(tree, ['signer@2.55.0', 'wallet@1.0.0']);
});

test('a copy hoisted to the root changes what the app signs with, and the tree shows it', () => {
  const tree = appTree(
    lock({
      'apps/mobile': { dependencies: { wallet: '1.0.0' } },
      'apps/mobile/node_modules/signer': { version: '2.55.0' },
      'node_modules/wallet': { version: '1.0.0', peerDependencies: { signer: '*' } },
      'node_modules/signer': { version: '2.56.0' },
    }),
  );
  assert.deepEqual(tree, ['signer@2.56.0', 'wallet@1.0.0']);
});

test('a workspace package is followed to where it lives, with its own dependencies', () => {
  const tree = appTree(
    lock({
      'apps/mobile': { dependencies: { '@pickler/rule': '*' }, devDependencies: { jest: '29' } },
      'node_modules/@pickler/rule': { resolved: 'packages/rule', link: true },
      'packages/rule': { name: '@pickler/rule', version: '0.0.0', dependencies: { hd: '2.3.0' } },
      'packages/rule/node_modules/hd': { version: '2.3.0' },
      'node_modules/hd': { version: '1.7.0' },
      'node_modules/jest': { version: '29.7.0' },
    }),
  );
  assert.deepEqual(tree, ['@pickler/rule@0.0.0', 'hd@2.3.0', 'jest@29.7.0']);
});
