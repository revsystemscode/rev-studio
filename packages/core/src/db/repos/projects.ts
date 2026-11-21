import { randomUUID } from 'node:crypto'
import type { Db } from '../open'

export interface ProjectRow {
  id: string
  name: string
  path: string
}

export function projectsRepo(db: Db) {
  const select = 'SELECT id, name, path FROM projects'
  return {
    list(): ProjectRow[] {
      return db.prepare(`${select} ORDER BY name COLLATE NOCASE`).all() as unknown as ProjectRow[]
    },
    get(id: string): ProjectRow | undefined {
      return db.prepare(`${select} WHERE id = ?`).get(id) as ProjectRow | undefined
    },
    getByPath(path: string): ProjectRow | undefined {
      return db.prepare(`${select} WHERE path = ?`).get(path) as ProjectRow | undefined
    },
    add(name: string, path: string): ProjectRow {
      const row = { id: randomUUID(), name, path }
      db.prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)').run(row.id, name, path)
      return row
    },
    remove(id: string): void {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    },
    setPath(id: string, path: string): void {
      db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(path, id)
    },
  }
}
