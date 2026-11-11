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
      CREATE INDEX IF NOT EXISTS event_type ON events(type);`);
  }
  // store methods
}
