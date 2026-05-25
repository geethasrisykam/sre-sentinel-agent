import Database from 'better-sqlite3';
import type { Database as DatabaseT } from 'better-sqlite3';
import type { IncidentRecord, IncidentState } from '@sre-sentinel/shared';
import { log } from './logger.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  state TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  problem_title TEXT NOT NULL,
  affected_entity TEXT NOT NULL,
  severity TEXT NOT NULL,
  record_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_received_at ON incidents(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_state ON incidents(state);
`;

export class IncidentRepository {
  private readonly db: DatabaseT;

  constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    log.info('db.ready', { path: databasePath });
  }

  insert(record: IncidentRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO incidents (id, received_at, updated_at, state, problem_id,
                             problem_title, affected_entity, severity, record_json)
      VALUES (@id, @receivedAt, @updatedAt, @state, @problemId,
              @problemTitle, @affectedEntity, @severity, @recordJson)
    `);
    stmt.run({
      id: record.id,
      receivedAt: record.receivedAt,
      updatedAt: record.updatedAt,
      state: record.state,
      problemId: record.problemId,
      problemTitle: record.problemTitle,
      affectedEntity: record.affectedEntity,
      severity: record.severity,
      recordJson: JSON.stringify(record),
    });
  }

  update(record: IncidentRecord): void {
    const stmt = this.db.prepare(`
      UPDATE incidents SET
        updated_at = @updatedAt,
        state = @state,
        record_json = @recordJson
      WHERE id = @id
    `);
    const info = stmt.run({
      id: record.id,
      updatedAt: record.updatedAt,
      state: record.state,
      recordJson: JSON.stringify(record),
    });
    if (info.changes === 0) {
      throw new Error(`No incident with id=${record.id}`);
    }
  }

  findById(id: string): IncidentRecord | null {
    const row = this.db.prepare('SELECT record_json FROM incidents WHERE id = ?').get(id) as
      | { record_json: string }
      | undefined;
    return row ? (JSON.parse(row.record_json) as IncidentRecord) : null;
  }

  listRecent(limit = 50): IncidentRecord[] {
    const rows = this.db
      .prepare('SELECT record_json FROM incidents ORDER BY received_at DESC LIMIT ?')
      .all(limit) as { record_json: string }[];
    return rows.map((r) => JSON.parse(r.record_json) as IncidentRecord);
  }

  countByState(state: IncidentState): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM incidents WHERE state = ?')
      .get(state) as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
