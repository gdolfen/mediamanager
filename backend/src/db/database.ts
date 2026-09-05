import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface DbPaths {
  upload: string;
  fotos: string;
  videos: string;
}

export const DEFAULT_PATHS: DbPaths = {
  upload: process.env.UPLOAD_DIR ?? '/upload',
  fotos: process.env.FOTOS_DIR ?? '/fotos',
  videos: process.env.VIDEOS_DIR ?? '/videos',
};

let db: DatabaseSync | null = null;

export function dataDir(): string {
  // trim(): schützt vor trailing Spaces (klassische Batch-Falle: `set DATA_DIR=...data `),
  // die sonst einen Geister-Ordner wie `data ` mit eigener DB erzeugen würden.
  const env = process.env.DATA_DIR?.trim();
  return env ? env : path.resolve(process.cwd(), 'data');
}

export function thumbnailsDir(): string {
  return path.join(dataDir(), 'thumbnails');
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(thumbnailsDir(), { recursive: true });
  const file = process.env.DB_FILE ?? path.join(dir, 'mediamanager.db');
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  migrateDevicesPerson(db);
  migrateDeviceIdentifierKinds(db);
  migrateFilesWhatsApp(db);
  migrateFilesMetaJson(db);
  migrateRunKinds(db);
  migrateFilesMd5(db);
  migrateScanProgressCounters(db);
  migrateFilesStatusIndexed(db);
  migrateFilesSourceStatusIndex(db);
  migrateFilesOriginalNameIndex(db);
  migrateStoppedStatus(db);
  migrateRunTotals(db);
  seedSettings(db);
  return db;
}

/** Run fn inside a BEGIN/COMMIT transaction. Rolls back on error. */
export function withTransaction(fn: () => void): void {
  const d = getDb();
  d.exec('BEGIN');
  try {
    fn();
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

/** Add devices.person to existing databases. */
function migrateDevicesPerson(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(devices)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'person')) {
    d.exec('ALTER TABLE devices ADD COLUMN person TEXT');
  }
}

/** Rebuild device_identifiers so the kind CHECK allows 'path' (existing databases). */
function migrateDeviceIdentifierKinds(d: DatabaseSync): void {
  const row = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'device_identifiers'").get() as { sql: string } | undefined;
  if (!row) return;
  if (/'path'/.test(row.sql)) return;
  d.exec('PRAGMA foreign_keys = OFF;');
  d.exec('BEGIN;');
  d.exec(`CREATE TABLE device_identifiers_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('exif','filename','path')),
    value TEXT NOT NULL,
    UNIQUE (kind, value)
  );`);
  d.exec('INSERT INTO device_identifiers_new (id, device_id, kind, value) SELECT id, device_id, kind, value FROM device_identifiers;');
  d.exec('DROP TABLE device_identifiers;');
  d.exec('ALTER TABLE device_identifiers_new RENAME TO device_identifiers;');
  d.exec('COMMIT;');
  d.exec('PRAGMA foreign_keys = ON;');
}

/** Add files.is_whatsapp to existing databases. */
function migrateFilesWhatsApp(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(files)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'is_whatsapp')) {
    d.exec('ALTER TABLE files ADD COLUMN is_whatsapp INTEGER NOT NULL DEFAULT 0');
  }
}

/** Add files.meta_json (full metadata blob) to existing databases. */
function migrateFilesMetaJson(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(files)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'meta_json')) {
    d.exec('ALTER TABLE files ADD COLUMN meta_json TEXT');
  }
}

/** Add files.md5 for additional dedup checking. */
function migrateFilesMd5(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(files)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'md5')) {
    d.exec('ALTER TABLE files ADD COLUMN md5 TEXT');
    d.exec('CREATE INDEX IF NOT EXISTS idx_files_md5 ON files(md5)');
  }
}

/** Add counter columns to scan_progress for resume support. */
function migrateScanProgressCounters(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(scan_progress)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'indexed')) {
    d.exec('ALTER TABLE scan_progress ADD COLUMN indexed INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'skipped')) {
    d.exec('ALTER TABLE scan_progress ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'linked')) {
    d.exec('ALTER TABLE scan_progress ADD COLUMN linked INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'new_files_count')) {
    d.exec('ALTER TABLE scan_progress ADD COLUMN new_files_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'problems')) {
    d.exec('ALTER TABLE scan_progress ADD COLUMN problems INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'run_id')) {
    d.exec('ALTER TABLE scan_progress ADD COLUMN run_id INTEGER');
  }
}

/** Convert 'problem' status to 'pending' and rebuild files table with 'indexed' status. */
function migrateFilesStatusIndexed(d: DatabaseSync): void {
  const row = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'files'").get() as { sql: string } | undefined;
  if (!row) return;
  // Already has 'indexed' in the CHECK constraint?
  if (/'indexed'/.test(row.sql)) return;
  // Convert existing 'problem' files to 'pending'
  d.exec("UPDATE files SET status = 'pending' WHERE status = 'problem'");
  // Rebuild table with new CHECK constraint
  d.exec('PRAGMA foreign_keys = OFF;');
  d.exec('BEGIN;');
  d.exec(`CREATE TABLE files_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT,
    md5 TEXT,
    source_root TEXT NOT NULL DEFAULT 'upload',
    source_rel_path TEXT NOT NULL,
    source_size INTEGER,
    source_mtime INTEGER,
    file_type TEXT NOT NULL CHECK (file_type IN ('image','video','other')),
    ext TEXT NOT NULL,
    original_name TEXT NOT NULL,
    target_root TEXT,
    target_rel_path TEXT,
    device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    device_raw TEXT,
    make TEXT,
    model TEXT,
    taken_at TEXT,
    date_source TEXT CHECK (date_source IN ('exif','quicktime','file','filename','override')),
    override_date TEXT,
    override_source TEXT CHECK (override_source IN ('file','meta','filename')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('indexed','pending','transferred')),
    transferred_at TEXT,
    is_whatsapp INTEGER NOT NULL DEFAULT 0,
    meta_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source_root, source_rel_path)
  );`);
  d.exec('INSERT INTO files_new SELECT id,hash,source_root,source_rel_path,source_size,source_mtime,file_type,ext,original_name,target_root,target_rel_path,device_id,device_raw,make,model,taken_at,date_source,override_date,override_source,status,transferred_at,created_at,updated_at,is_whatsapp,meta_json,md5 FROM files;');
  d.exec('DROP TABLE files;');
  d.exec('ALTER TABLE files_new RENAME TO files;');
  d.exec('CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);');
  d.exec('CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);');
  d.exec('CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_root, source_rel_path);');
  d.exec('CREATE INDEX IF NOT EXISTS idx_files_md5 ON files(md5);');
  d.exec('COMMIT;');
  d.exec('PRAGMA foreign_keys = ON;');
}

/** Composite index for nextIndexedFiles queries during analyze phase. */
function migrateFilesSourceStatusIndex(d: DatabaseSync): void {
  d.exec('CREATE INDEX IF NOT EXISTS idx_files_source_status_id ON files(source_root, status, id);');
}

/** Index für den Transferred-Check (Dateiname-Lookup in der Bibliothek, case-insensitiv). */
function migrateFilesOriginalNameIndex(d: DatabaseSync): void {
  d.exec('CREATE INDEX IF NOT EXISTS idx_files_original_name ON files(original_name COLLATE NOCASE);');
}

/** Add 'stopped' status for manual UI stops (vs 'aborted' for crashes). */
function migrateStoppedStatus(d: DatabaseSync): void {
  // scan_progress: recreate with updated CHECK
  d.exec(`CREATE TABLE IF NOT EXISTS scan_progress_new (
    scan_type TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('running','completed','aborted','stopped')),
    started_at TEXT,
    finished_at TEXT,
    total_dirs INTEGER NOT NULL DEFAULT 0,
    total_files INTEGER NOT NULL DEFAULT 0,
    scanned INTEGER NOT NULL DEFAULT 0,
    indexed INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    linked INTEGER NOT NULL DEFAULT 0,
    new_files_count INTEGER NOT NULL DEFAULT 0,
    problems INTEGER NOT NULL DEFAULT 0,
    current TEXT,
    run_id INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  d.exec('INSERT OR IGNORE INTO scan_progress_new (scan_type, status, started_at, finished_at, total_dirs, total_files, scanned, current, updated_at, indexed, skipped, linked, new_files_count, problems, run_id) SELECT scan_type, status, started_at, finished_at, total_dirs, total_files, scanned, current, updated_at, indexed, skipped, linked, new_files_count, problems, run_id FROM scan_progress;');
  d.exec('DROP TABLE IF EXISTS scan_progress;');
  d.exec('ALTER TABLE scan_progress_new RENAME TO scan_progress;');

  // transfer_runs: recreate with updated CHECK
  d.exec(`CREATE TABLE IF NOT EXISTS transfer_runs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'transfer',
    status TEXT NOT NULL CHECK (status IN ('running','completed','aborted','stopped')),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    total_dirs INTEGER NOT NULL DEFAULT 0,
    total_files INTEGER NOT NULL DEFAULT 0,
    scanned INTEGER NOT NULL DEFAULT 0,
    transferred INTEGER NOT NULL DEFAULT 0,
    indexed INTEGER NOT NULL DEFAULT 0,
    new_files INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    problems INTEGER NOT NULL DEFAULT 0
  );`);
  d.exec('INSERT OR IGNORE INTO transfer_runs_new (id, kind, status, started_at, finished_at, scanned, transferred, indexed, new_files, skipped, problems) SELECT id, kind, status, started_at, finished_at, scanned, transferred, indexed, new_files, skipped, problems FROM transfer_runs;');
  d.exec('DROP TABLE IF EXISTS transfer_runs;');
  d.exec('ALTER TABLE transfer_runs_new RENAME TO transfer_runs;');
  d.exec('CREATE INDEX IF NOT EXISTS idx_runs_kind ON transfer_runs(kind);');
}

/** Add total_dirs/total_files to the run history table. */
function migrateRunTotals(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(transfer_runs)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'total_dirs')) {
    d.exec('ALTER TABLE transfer_runs ADD COLUMN total_dirs INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'total_files')) {
    d.exec('ALTER TABLE transfer_runs ADD COLUMN total_files INTEGER NOT NULL DEFAULT 0');
  }
}

/** Extend transfer_runs into a general run history (kind, indexed, new_files). */
function migrateRunKinds(d: DatabaseSync): void {
  const cols = d.prepare('PRAGMA table_info(transfer_runs)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'kind')) {
    d.exec("ALTER TABLE transfer_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'transfer'");
  }
  if (!cols.some((c) => c.name === 'indexed')) {
    d.exec('ALTER TABLE transfer_runs ADD COLUMN indexed INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'new_files')) {
    d.exec('ALTER TABLE transfer_runs ADD COLUMN new_files INTEGER NOT NULL DEFAULT 0');
  }
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mapped_name TEXT NOT NULL,
      person TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS device_identifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('exif','filename','path')),
      value TEXT NOT NULL,
      UNIQUE (kind, value)
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT,
      md5 TEXT,
      source_root TEXT NOT NULL DEFAULT 'upload',
      source_rel_path TEXT NOT NULL,
      source_size INTEGER,
      source_mtime INTEGER,
      file_type TEXT NOT NULL CHECK (file_type IN ('image','video','other')),
      ext TEXT NOT NULL,
      original_name TEXT NOT NULL,
      target_root TEXT,
      target_rel_path TEXT,
      device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
      device_raw TEXT,
      make TEXT,
      model TEXT,
      taken_at TEXT,
      date_source TEXT CHECK (date_source IN ('exif','quicktime','file','filename','override')),
      override_date TEXT,
      override_source TEXT CHECK (override_source IN ('file','meta','filename')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','transferred','problem')),
      transferred_at TEXT,
      is_whatsapp INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source_root, source_rel_path)
    );

    CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
    CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
    CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_root, source_rel_path);

    CREATE TABLE IF NOT EXISTS problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      message TEXT NOT NULL,
      action_type TEXT,
      action_params TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (file_id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_problems_resolved ON problems(resolved);

    CREATE TABLE IF NOT EXISTS thumbnail_queue (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transfer_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'transfer',
      status TEXT NOT NULL CHECK (status IN ('running','completed','aborted')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      scanned INTEGER NOT NULL DEFAULT 0,
      transferred INTEGER NOT NULL DEFAULT 0,
      indexed INTEGER NOT NULL DEFAULT 0,
      new_files INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      problems INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS formats (
      ext TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      supported INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
      source TEXT NOT NULL DEFAULT 'app',
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);

    CREATE TABLE IF NOT EXISTS scan_progress (
      scan_type TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('running','completed','aborted')),
      started_at TEXT,
      finished_at TEXT,
      total_dirs INTEGER NOT NULL DEFAULT 0,
      total_files INTEGER NOT NULL DEFAULT 0,
      scanned INTEGER NOT NULL DEFAULT 0,
      current TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scan_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_type TEXT NOT NULL,
      root TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT,
      UNIQUE (scan_type, root, rel_path)
    );

    CREATE INDEX IF NOT EXISTS idx_scan_queue_pending ON scan_queue(scan_type, done, id);

    CREATE TABLE IF NOT EXISTS ignored (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('file', 'folder')),
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (scope, path)
    );
  `);
}

function seedSettings(d: DatabaseSync): void {
  const insert = d.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insert.run('paths.upload', DEFAULT_PATHS.upload);
  insert.run('paths.fotos', DEFAULT_PATHS.fotos);
  insert.run('paths.videos', DEFAULT_PATHS.videos);
  insert.run('schedule.enabled', '0');
  insert.run('schedule.intervalMinutes', '60');
  insert.run('schedule.mode', 'scan');
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getPaths(): DbPaths {
  return {
    upload: getSetting('paths.upload') ?? DEFAULT_PATHS.upload,
    fotos: getSetting('paths.fotos') ?? DEFAULT_PATHS.fotos,
    videos: getSetting('paths.videos') ?? DEFAULT_PATHS.videos,
  };
}

export function setPaths(p: DbPaths): void {
  setSetting('paths.upload', p.upload);
  setSetting('paths.fotos', p.fotos);
  setSetting('paths.videos', p.videos);
}

export function rootBase(root: 'upload' | 'fotos' | 'videos'): string {
  return getPaths()[root];
}

export function closeDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}