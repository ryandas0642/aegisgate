import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hash, equalSecret } from '../control/security.js';
test('proposal hashes preserve meaning across key order and detect changed targets', () => {
  assert.deepEqual(canonical({ b: 2, a: { d: 4, c: 3 } }), { a: { c: 3, d: 4 }, b: 2 });
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
  assert.notEqual(hash({ source: '127.0.0.2', ttl: 60 }), hash({ source: '127.0.0.3', ttl: 60 }));
  assert.ok(equalSecret('local-token', 'local-token'));
  assert.ok(!equalSecret('wrong', 'local-token'));
});
