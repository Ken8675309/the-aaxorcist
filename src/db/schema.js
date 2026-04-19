export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    label TEXT,
    is_active INTEGER DEFAULT 0,
    credentials TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activation_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hex_key TEXT NOT NULL,
    label TEXT,
    book_title TEXT,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    input_path TEXT NOT NULL,
    output_path TEXT,
    filename TEXT NOT NULL,
    format TEXT NOT NULL,
    quality TEXT,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'pending',
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`
