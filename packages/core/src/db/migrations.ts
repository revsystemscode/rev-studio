/** Migraciones numeradas: el índice + 1 es la versión que deja cada una. Nunca editar una ya publicada. */
export const migrations: string[] = [
  `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  turn_status TEXT NOT NULL DEFAULT 'idle',
  turn_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  parts TEXT NOT NULL,
  covers_upto_seq INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, seq)
);
CREATE TABLE file_snapshots (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  existed INTEGER NOT NULL,
  original TEXT,
  PRIMARY KEY(session_id, path)
);
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  UNIQUE(project_id, tool_name, pattern)
);
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  key_cipher TEXT,
  context_size INTEGER
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`,
]
