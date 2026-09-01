import { getDb } from './database.js';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogQuery {
  limit?: number;
  offset?: number;
  level?: LogLevel;
}

export interface LogPage {
  rows: LogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export function log(level: LogLevel, source: string, message: string): void {
  const line = `[${level.toUpperCase()}] ${source}: ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  try {
    getDb().prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(level, source, message);
  } catch (err) {
    console.error('Logging fehlgeschlagen:', err);
  }
}

export const logger = {
  info: (source: string, message: string) => log('info', source, message),
  warn: (source: string, message: string) => log('warn', source, message),
  error: (source: string, message: string) => log('error', source, message),
};

export function listLogs(q: LogQuery = {}): LogPage {
  const limit = Math.min(500, Math.max(1, q.limit ?? 100));
  const offset = Math.max(0, q.offset ?? 0);
  const db = getDb();
  let total: number;
  let rows: LogEntry[];
  if (q.level) {
    total = (db.prepare('SELECT COUNT(*) AS c FROM logs WHERE level = ?').get(q.level) as { c: number }).c;
    rows = db
      .prepare('SELECT id, ts, level, source, message FROM logs WHERE level = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(q.level, limit, offset) as unknown as LogEntry[];
  } else {
    total = (db.prepare('SELECT COUNT(*) AS c FROM logs').get() as { c: number }).c;
    rows = db
      .prepare('SELECT id, ts, level, source, message FROM logs ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as unknown as LogEntry[];
  }
  return { rows, total, limit, offset };
}

export function countLogs(level?: LogLevel): number {
  const db = getDb();
  if (level) {
    return (db.prepare('SELECT COUNT(*) AS c FROM logs WHERE level = ?').get(level) as { c: number }).c;
  }
  return (db.prepare('SELECT COUNT(*) AS c FROM logs').get() as { c: number }).c;
}

export function clearLogs(): void {
  getDb().prepare('DELETE FROM logs').run();
}