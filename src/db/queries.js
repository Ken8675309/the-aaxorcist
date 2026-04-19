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

// ── Accounts ──────────────────────────────────────────────────────────────────

export function getAccounts() {
  return getDb().prepare('SELECT * FROM accounts ORDER BY created_at').all()
}

export function getActiveAccount() {
  return getDb().prepare('SELECT * FROM accounts WHERE is_active = 1 LIMIT 1').get()
}

export function addAccount({ email, label, credentials }) {
  const db = getDb()
  db.prepare('UPDATE accounts SET is_active = 0').run()
  return db
    .prepare(
      'INSERT OR REPLACE INTO accounts (email, label, credentials, is_active) VALUES (?, ?, ?, 1)'
    )
    .run(email, label || email, JSON.stringify(credentials))
}

export function switchAccount(id) {
  const db = getDb()
  db.prepare('UPDATE accounts SET is_active = 0').run()
  db.prepare('UPDATE accounts SET is_active = 1 WHERE id = ?').run(id)
}

export function removeAccount(id) {
  const db = getDb()
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  const remaining = db.prepare('SELECT id FROM accounts LIMIT 1').get()
  if (remaining) {
    db.prepare('UPDATE accounts SET is_active = 1 WHERE id = ?').run(remaining.id)
  }
}

export function updateAccountCredentials(id, credentials) {
  getDb()
    .prepare('UPDATE accounts SET credentials = ? WHERE id = ?')
    .run(JSON.stringify(credentials), id)
}

// ── Activation Keys ───────────────────────────────────────────────────────────

export function getKeys() {
  return getDb()
    .prepare(
      `SELECT k.*, a.email as account_email FROM activation_keys k
       LEFT JOIN accounts a ON k.account_id = a.id
       ORDER BY k.created_at DESC`
    )
    .all()
}

export function findKey(accountId) {
  return getDb()
    .prepare('SELECT * FROM activation_keys WHERE account_id = ? LIMIT 1')
    .get(accountId)
}

export function addKey({ hexKey, label, bookTitle, accountId }) {
  return getDb()
    .prepare(
      'INSERT INTO activation_keys (hex_key, label, book_title, account_id) VALUES (?, ?, ?, ?)'
    )
    .run(hexKey, label || bookTitle || 'Manual entry', bookTitle, accountId)
}

export function deleteKey(id) {
  getDb().prepare('DELETE FROM activation_keys WHERE id = ?').run(id)
}

// ── History ───────────────────────────────────────────────────────────────────

export function getHistory() {
  return getDb()
    .prepare(
      `SELECT h.*, a.email as account_email FROM history h
       LEFT JOIN accounts a ON h.account_id = a.id
       ORDER BY h.created_at DESC LIMIT 500`
    )
    .all()
}

export function addHistory({ inputPath, outputPath, filename, format, quality, accountId }) {
  return getDb()
    .prepare(
      `INSERT INTO history (input_path, output_path, filename, format, quality, account_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'success')`
    )
    .run(inputPath, outputPath, filename, format, quality, accountId)
}

export function addHistoryError({ inputPath, filename, format, accountId, error }) {
  return getDb()
    .prepare(
      `INSERT INTO history (input_path, filename, format, account_id, status, error)
       VALUES (?, ?, ?, ?, 'error', ?)`
    )
    .run(inputPath, filename, format, accountId, error)
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
