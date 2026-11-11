import type { Db } from '../open'

interface Row {
  path: string
  existed: number
  original: string | null
}

const toOriginal = (r: Row): string | null => (r.existed ? (r.original ?? '') : null)

/** `original: null` significa que el archivo no existía antes de la sesión. */
export function snapshotsRepo(db: Db) {
  return {
    get(sessionId: string, path: string): { original: string | null } | undefined {
      const row = db
        .prepare('SELECT path, existed, original FROM file_snapshots WHERE session_id = ? AND path = ?')
        .get(sessionId, path) as Row | undefined
      return row && { original: toOriginal(row) }
    },
    put(sessionId: string, path: string, original: string | null): void {
      db.prepare(
        'INSERT OR IGNORE INTO file_snapshots (session_id, path, existed, original) VALUES (?, ?, ?, ?)',
      ).run(sessionId, path, original === null ? 0 : 1, original)
    },
    list(sessionId: string): { path: string; original: string | null }[] {
      const rows = db
        .prepare('SELECT path, existed, original FROM file_snapshots WHERE session_id = ? ORDER BY path')
        .all(sessionId) as unknown as Row[]
      return rows.map((r) => ({ path: r.path, original: toOriginal(r) }))
    },
    remove(sessionId: string, path: string): void {
      db.prepare('DELETE FROM file_snapshots WHERE session_id = ? AND path = ?').run(sessionId, path)
    },
  }
}
