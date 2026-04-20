import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { SCHEMA } from './schema.js'

let db = null

export function getDb() {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'aax-converter.sqlite')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
  }
  return db
}

// ── Activation Keys ───────────────────────────────────────────────────────────

export function getKeys() {
  return getDb()
    .prepare('SELECT * FROM activation_keys ORDER BY date_added DESC')
    .all()
}

export function findKeyByChecksum(checksum) {
  return getDb()
    .prepare('SELECT * FROM activation_keys WHERE checksum = ? LIMIT 1')
    .get(checksum)
}

export function addKey({ hexKey, checksum, bookTitle, filePath }) {
  if (checksum) {
    return getDb()
      .prepare(
        `INSERT INTO activation_keys (checksum, activation_bytes, book_title, file_path)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(checksum) DO UPDATE SET
           activation_bytes = excluded.activation_bytes,
           book_title = excluded.book_title,
           file_path = excluded.file_path`
      )
      .run(checksum, hexKey, bookTitle || null, filePath || null)
  }
  // Manual entry without checksum — plain insert, no upsert
  return getDb()
    .prepare(
      `INSERT INTO activation_keys (activation_bytes, book_title, file_path)
       VALUES (?, ?, ?)`
    )
    .run(hexKey, bookTitle || null, filePath || null)
}

export function deleteKey(id) {
  getDb().prepare('DELETE FROM activation_keys WHERE id = ?').run(id)
}

// ── History ───────────────────────────────────────────────────────────────────

export function getHistory() {
  return getDb()
    .prepare('SELECT * FROM history ORDER BY created_at DESC LIMIT 500')
    .all()
}

export function addHistory({ inputPath, outputPath, filename, format, quality }) {
  return getDb()
    .prepare(
      `INSERT INTO history (input_path, output_path, filename, format, quality, status)
       VALUES (?, ?, ?, ?, ?, 'success')`
    )
    .run(inputPath, outputPath, filename, format, quality)
}

export function addHistoryError({ inputPath, filename, format, error }) {
  return getDb()
    .prepare(
      `INSERT INTO history (input_path, filename, format, status, error)
       VALUES (?, ?, ?, 'error', ?)`
    )
    .run(inputPath, filename, format, error)
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function getSetting(key, defaultValue = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? JSON.parse(row.value) : defaultValue
}

export function setSetting(key, value) {
  getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, JSON.stringify(value))
}

export function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all()
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
}
