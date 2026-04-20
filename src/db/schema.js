export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS activation_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checksum TEXT UNIQUE,
    activation_bytes TEXT NOT NULL,
    book_title TEXT,
    file_path TEXT,
    date_added TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    input_path TEXT NOT NULL,
    output_path TEXT,
    filename TEXT NOT NULL,
    format TEXT NOT NULL,
    quality TEXT,
    status TEXT DEFAULT 'pending',
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`
