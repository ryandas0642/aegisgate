import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { hash } from './security.js';
import { redact } from './redact.js';
import type { Evidence, Incident, Proposal, Snapshot } from './types.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, id TEXT UNIQUE, time TEXT, type TEXT, payload TEXT, previous TEXT, digest TEXT);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, time TEXT, type TEXT, data TEXT);
      CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, eventId TEXT UNIQUE, data TEXT);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, data TEXT);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, data TEXT);
      CREATE INDEX IF NOT EXISTS event_type ON events(type);
      CREATE TABLE IF NOT EXISTS tool_evidence (id TEXT PRIMARY KEY, data TEXT);`);
  }
  audit(type: string, payload: unknown): void {
    const last = this.db
      .prepare('SELECT seq, digest FROM audit ORDER BY seq DESC LIMIT 1')
      .get() as { seq: number; digest: string } | undefined;
    const record = {
      seq: (last?.seq ?? 0) + 1,
      id: randomUUID(),
      time: new Date().toISOString(),
      type,
      payload: redact(payload),
      previous: last?.digest ?? '0'.repeat(64),
    };
    this.db
      .prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?)')
      .run(
        record.seq,
        record.id,
        record.time,
        record.type,
        JSON.stringify(record.payload),
        record.previous,
        hash(record),
      );
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  set(key: string, data: unknown): void {
    this.db
      .prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
      .run(key, JSON.stringify(data));
  }
  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM meta WHERE key=?').get(key) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  putIncident(incident: Incident): void {
    this.db
      .prepare(
        'INSERT INTO incidents VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(incident.id, incident.eventId, JSON.stringify(incident));
  }
  incident(id: string): Incident | undefined {
    const row = this.db.prepare('SELECT data FROM incidents WHERE id=?').get(id) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  incidents(): Incident[] {
    return (
      this.db.prepare('SELECT data FROM incidents ORDER BY rowid DESC LIMIT 100').all() as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data));
  }
  putProposal(proposal: Proposal): void {
    this.db
      .prepare('INSERT INTO proposals VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(proposal.id, JSON.stringify(proposal));
  }
  proposal(id: string): Proposal | undefined {
    const row = this.db.prepare('SELECT data FROM proposals WHERE id=?').get(id) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  proposals(): Proposal[] {
    return (
      this.db.prepare('SELECT data FROM proposals ORDER BY rowid DESC LIMIT 100').all() as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data));
  }
  events(limit = 100): Evidence[] {
    return (
      this.db
        .prepare('SELECT data FROM events ORDER BY rowid DESC LIMIT ?')
        .all(Math.min(500, Math.max(1, limit))) as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
  evidence(id: string): Evidence | undefined {
    const row = (this.db.prepare('SELECT data FROM events WHERE id=?').get(id) ||
      this.db.prepare('SELECT data FROM tool_evidence WHERE id=?').get(id)) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  toolEvidence(id: string, result: unknown, incident: Incident): void {
    const value = {
      id,
      time: new Date().toISOString(),
      type: 'tool.evidence',
      source: incident.source,
      backend: incident.backend,
      result,
    };
    this.db
      .prepare('INSERT OR IGNORE INTO tool_evidence VALUES(?,?)')
      .run(id, JSON.stringify(redact(value)));
  }
  ingest(snapshot: Snapshot): void {
    this.transaction(() => {
      const cursor = this.get<{ epoch: string; sequence: number }>('cursor');
      if (cursor?.epoch === snapshot.epoch && cursor.sequence + 1 < snapshot.oldestSequence)
        this.audit('telemetry.gap', {
          expected: cursor.sequence + 1,
          oldest: snapshot.oldestSequence,
          epoch: snapshot.epoch,
        });
      if (cursor && cursor.epoch !== snapshot.epoch)
        this.audit('proxy.restarted', { previous: cursor.epoch, current: snapshot.epoch });
      for (const event of snapshot.events) {
        const inserted = this.db
          .prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?)')
          .run(event.id, event.time, event.type, JSON.stringify(event));
        if (!inserted.changes || !event.type.startsWith('detection.')) continue;
        const incident: Incident = {
          id: randomUUID(),
          eventId: event.id,
          kind: event.type === 'detection.security' ? 'security' : 'reliability',
          source: event.source,
          backend: event.backend,
          createdAt: event.time,
          status: 'detected',
        };
        this.putIncident(incident);
        this.audit('incident.detected', { incident, evidence: event });
      }
      this.set('cursor', { epoch: snapshot.epoch, sequence: snapshot.sequence });
      this.set('snapshot', { ...snapshot, events: [] });
      this.set('connection', { online: true, receivedAt: Date.now(), error: null });
    });
  }
  auditRecords(limit = 100): Record<string, unknown>[] {
    return (
      this.db
        .prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?')
        .all(Math.min(500, limit)) as Record<string, unknown>[]
    ).map((row) => ({ ...row, payload: JSON.parse(String(row.payload)) }));
  }
  verifyAudit(): boolean {
    let previous = '0'.repeat(64),
      sequence = 0;
    for (const row of this.db.prepare('SELECT * FROM audit ORDER BY seq').all() as {
      seq: number;
      id: string;
      time: string;
      type: string;
      payload: string;
      previous: string;
      digest: string;
    }[]) {
      const record = {
        seq: row.seq,
        id: row.id,
        time: row.time,
        type: row.type,
        payload: JSON.parse(row.payload),
        previous: row.previous,
      };
      if (row.seq !== ++sequence || row.previous !== previous || hash(record) !== row.digest)
        return false;
      previous = row.digest;
    }
    return true;
  }
}
