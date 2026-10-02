import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState } from './build-state.mjs';
const expected = { id: 'new', appId: 'app', version: '1.2', buildNumber: '7' };
const response = () => ({
  data: {
    type: 'builds',
    id: 'new',
    attributes: { version: '7', processingState: 'VALID' },
    relationships: {
      app: { data: { id: 'app' } },
      preReleaseVersion: { data: { id: 'version' } },
    },
  },
  included: [
    {
      type: 'preReleaseVersions',
      id: 'version',
      attributes: { version: '1.2' },
    },
  ],
});
test('VALID only proves processing, never distribution', () =>
  assert.equal(buildState(response(), expected).distribution, 'unverified'));
test('rejects previous build, different app, marketing version and missing identity', () => {
  for (const key of ['id', 'appId', 'version', 'buildNumber'])
    assert.throws(() =>
      buildState(response(), { ...expected, [key]: 'wrong' }),
    );
  assert.throws(() => buildState(response(), {}));
});
test('pending and failed states do not become success', () => {
  for (const [state, result] of [
    ['PROCESSING', 'pending'],
    ['FAILED', 'failed'],
    ['INVALID', 'failed'],
  ]) {
    const r = response();
    r.data.attributes.processingState = state;
    assert.equal(buildState(r, expected).processing, result);
  }
});
