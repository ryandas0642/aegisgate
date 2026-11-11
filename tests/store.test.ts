import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../control/store.js';
import { snapshot } from './fixtures.js';
test('ingestion deduplicates events, records gaps, and detects audit edits', t => {
  const store = new Store(); t.after(() => store.db.close()); const value = snapshot(); store.ingest(value); store.ingest(value);
  assert.equal(store.incidents().length, 1); assert.equal(store.events().length, 1);
  store.ingest({ ...value, oldestSequence: 9, sequence: 10, events: [] });
  assert.ok(store.auditRecords().some(row => row.type === 'telemetry.gap')); assert.ok(store.verifyAudit());
  store.db.exec("UPDATE audit SET payload='{}' WHERE seq=1"); assert.equal(store.verifyAudit(), false);
});
