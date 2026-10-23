import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Email } from './types.js';
import { JobError } from './errors.js';

export async function acquireLock(path: string): Promise<(() => Promise<void>) | null> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try { await mkdir(`${path}.lock`, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const info = await stat(`${path}.lock`);
    if (Date.now() - info.mtimeMs > 11 * 60_000)
      throw new JobError('STALE_LOCK', 'A prior job lock is stale; verify the process has stopped and reconcile delivery before removing it.', 'lock');
    return null;
  }
  try { await writeFile(`${path}.lock/owner.json`, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { mode: 0o600 }); }
  catch (error) { await rm(`${path}.lock`, { recursive: true }); throw error; }
  return () => rm(`${path}.lock`, { recursive: true });
}
export type DeliveryStatus = 'prepared' | 'sending' | 'accepted' | 'rejected' | 'unknown' | 'superseded';
export class State {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, date TEXT NOT NULL, started TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT);
      CREATE TABLE IF NOT EXISTS snapshots (run_id TEXT PRIMARY KEY, content TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, digest_key TEXT NOT NULL, run_id TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT NOT NULL UNIQUE, content_hash TEXT NOT NULL, reason TEXT, updated TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_delivery ON deliveries(digest_key) WHERE status IN ('prepared', 'sending', 'unknown');`);
  }
  start(runId: string, date: string) { this.db.prepare('INSERT INTO runs VALUES (?,?,?,?,NULL)').run(runId, date, new Date().toISOString(), 'running'); }
  finish(runId: string, status: string, code?: string) { this.db.prepare('UPDATE runs SET status=?, error_code=? WHERE id=?').run(status, code || null, runId); }
  snapshot(runId: string, value: unknown) { this.db.prepare('INSERT INTO snapshots VALUES (?,?)').run(runId, JSON.stringify(value)); }
  disposition(key: string): 'new' | 'accepted' | 'ambiguous' {
    const rows = this.db.prepare('SELECT status FROM deliveries WHERE digest_key=?').all(key) as { status: DeliveryStatus }[];
    if (rows.some(r => ['sending', 'unknown', 'prepared'].includes(r.status))) return 'ambiguous';
    return rows.some(r => r.status === 'accepted') ? 'accepted' : 'new';
  }
  prepare(key: string, runId: string, email: Email, sender: string, reason?: string): { id: string; messageId: string } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const disposition = this.disposition(key);
      if (disposition !== 'new' && !reason) throw new JobError('DELIVERY_BLOCKED', 'Digest already accepted or delivery outcome requires review.', 'delivery');
      // Explicit operator override retains the old attempt and reason in history, while allowing a new attempt.
      if (reason) this.db.prepare("UPDATE deliveries SET status='superseded', reason=COALESCE(reason,'') || ? WHERE digest_key=? AND status IN ('prepared','sending','unknown')").run(`; operator override: ${reason}`, key);
      const id = randomUUID(); const messageId = `<${id}@${sender.split('@')[1]}>`;
      this.db.prepare('INSERT INTO deliveries VALUES (?,?,?,?,?,?,?,?)').run(id, key, runId, 'prepared', messageId, createHash('sha256').update(JSON.stringify(email)).digest('hex'), reason || null, new Date().toISOString());
      this.db.exec('COMMIT'); return { id, messageId };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  mark(id: string, status: DeliveryStatus) { this.db.prepare('UPDATE deliveries SET status=?, updated=? WHERE id=?').run(status, new Date().toISOString(), id); }
  close() { this.db.close(); }
}
