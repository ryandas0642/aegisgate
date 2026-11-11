import test from 'node:test';
import assert from 'node:assert/strict';
import { Broker } from '../control/broker.js';
import { seed, action, FakeProxy } from './fixtures.js';
import { snapshot } from './fixtures.js';
import { Store } from '../control/store.js';

test('approval binds the exact immutable proposal and is consumed once', async (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  const proxy = new FakeProxy(),
    broker = new Broker(store, proxy);
  const proposal = await broker.propose(incident.id, action(), 'fixture');
  assert.equal(proxy.calls, 0);
  await assert.rejects(broker.approve(proposal.id, proposal.hash, 'investigator'), /approval/);
  await assert.rejects(broker.approve(proposal.id, 'altered', 'local-operator'), /approval/);
  await assert.rejects(
    broker.propose(incident.id, { ...action(), source: '127.0.0.3' }, 'fixture'),
    /target/,
  );
  await assert.rejects(
    broker.propose(incident.id, { ...action(), ttlSeconds: 601 }, 'fixture'),
    /catalog/,
  );
  const results = await Promise.allSettled([
    broker.approve(proposal.id, proposal.hash, 'local-operator'),
    broker.approve(proposal.id, proposal.hash, 'local-operator'),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(proxy.calls, 1);
  assert.ok(store.verifyAudit());
});
test('changed state, expired approval, and altered stored content reject before enforcement', async (t) => {
  for (const mode of ['state', 'expired', 'altered']) {
    const { store, incident } = seed();
    t.after(() => store.db.close());
    const proxy = new FakeProxy(),
      broker = new Broker(store, proxy);
    const proposal = await broker.propose(incident.id, action(), 'fixture');
    if (mode === 'state') proxy.state.revision++;
    if (mode === 'expired') {
      proposal.approvalDeadline = Date.now() - 1;
      store.putProposal(proposal);
    }
    if (mode === 'altered') {
      proposal.content.ttlSeconds = 600;
      store.putProposal(proposal);
    }
    await assert.rejects(broker.approve(proposal.id, proposal.hash, 'local-operator'));
    assert.equal(proxy.calls, 0);
  }
});
test('lost acknowledgements reconcile without repeating a state change', async (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  const proxy = new FakeProxy(),
    broker = new Broker(store, proxy);
  proxy.failAfterApply = true;
  const p = await broker.propose(incident.id, action(), 'fixture');
  assert.equal((await broker.approve(p.id, p.hash, 'local-operator')).status, 'uncertain');
  store.ingest(proxy.state);
  broker.reconcile(proxy.state);
  assert.equal(store.proposal(p.id)?.status, 'inconclusive');
  assert.equal(proxy.calls, 1);
  proxy.state.events.push(
    {
      id: 'target-3',
      sequence: 3,
      epoch: proxy.state.epoch,
      time: new Date().toISOString(),
      type: 'request.completed',
      source: '127.0.0.2',
      status: 403,
    },
    {
      id: 'control-4',
      sequence: 4,
      epoch: proxy.state.epoch,
      time: new Date().toISOString(),
      type: 'request.completed',
      source: '127.0.0.1',
      status: 200,
    },
  );
  proxy.state.sequence = 4;
  store.ingest(proxy.state);
  broker.reconcile(proxy.state);
  assert.equal(store.proposal(p.id)?.status, 'verified');
  proxy.state.epoch = 'new-epoch';
  store.ingest(proxy.state);
  broker.reconcile(proxy.state);
  assert.equal(store.proposal(p.id)?.status, 'interrupted');
});

test('stale proposals release their incident and old detections cannot authorize fresh changes', async (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  const proxy = new FakeProxy(),
    broker = new Broker(store, proxy);
  const proposal = await broker.propose(incident.id, action(), 'fixture');
  proposal.approvalDeadline = Date.now() - 1;
  store.putProposal(proposal);
  broker.reconcile(proxy.state);
  assert.equal(store.proposal(proposal.id)?.status, 'stale');
  assert.notEqual(store.incident(incident.id)?.status, 'awaiting_approval');
  const history = new Store();
  t.after(() => history.db.close());
  const old = snapshot();
  old.events[0].time = new Date(Date.now() - 301000).toISOString();
  history.ingest(old);
  await assert.rejects(
    new Broker(history, proxy).propose(history.incidents()[0].id, action(), 'fixture'),
    /historical or stale/,
  );
});

test('a verified result survives movement out of the recent-event window', async (t) => {
  const { store, incident } = seed();
  t.after(() => store.db.close());
  const proxy = new FakeProxy(),
    broker = new Broker(store, proxy);
  const p = await broker.propose(incident.id, action(), 'fixture');
  await broker.approve(p.id, p.hash, 'local-operator');
  proxy.state.events.push(
    {
      id: 'target-3',
      sequence: 3,
      epoch: proxy.state.epoch,
      time: new Date().toISOString(),
      type: 'request.completed',
      source: p.content.source,
      status: 403,
    },
    {
      id: 'control-4',
      sequence: 4,
      epoch: proxy.state.epoch,
      time: new Date().toISOString(),
      type: 'request.completed',
      source: '127.0.0.1',
      status: 200,
    },
  );
  proxy.state.sequence = 4;
  store.ingest(proxy.state);
  broker.reconcile(proxy.state);
  assert.equal(store.proposal(p.id)?.status, 'verified');
  for (let i = 5; i < 510; i++)
    proxy.state.events.push({
      id: 'later-' + i,
      sequence: i,
      epoch: proxy.state.epoch,
      time: new Date().toISOString(),
      type: 'request.completed',
      source: '127.0.0.1',
      status: 200,
    });
  proxy.state.sequence = 509;
  store.ingest(proxy.state);
  broker.reconcile(proxy.state);
  assert.equal(store.proposal(p.id)?.status, 'verified');
});
