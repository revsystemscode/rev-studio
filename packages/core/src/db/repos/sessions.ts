import { randomUUID } from 'node:crypto'
import type { Session, TurnStatus } from '@rev/protocol'
import type { Db } from '../open'

export const DEFAULT_SESSION_TITLE = 'Nueva sesión'

interface Row {
  id: string
  project_id: string
  title: string
  provider_id: string
  model: string
  turn_status: TurnStatus
  turn_error: string | null
  created_at: number
  updated_at: number
}

function toSession(r: Row): Session {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    providerId: r.provider_id,
    model: r.model,
    turnStatus: r.turn_status,
    turnError: r.turn_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function sessionsRepo(db: Db) {
  const touch = (sql: string, ...args: (string | null)[]) =>
    db.prepare(`UPDATE sessions SET ${sql}, updated_at = ? WHERE id = ?`).run(...args.slice(0, -1), Date.now(), args.at(-1)!)

  const repo = {
    list(projectId: string): Session[] {
      const rows = db
        .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(projectId) as unknown as Row[]
      return rows.map(toSession)
    },
    get(id: string): Session | undefined {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined
      return row && toSession(row)
    },
    create(projectId: string, providerId: string, model: string): Session {
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        'INSERT INTO sessions (id, project_id, title, provider_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, projectId, DEFAULT_SESSION_TITLE, providerId, model, now, now)
      return repo.get(id)!
    },
    remove(id: string): void {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    },
    setModel(id: string, providerId: string, model: string): void {
      touch('provider_id = ?, model = ?', providerId, model, id)
    },
    setTitle(id: string, title: string): void {
      touch('title = ?', title, id)
    },
    setTurnStatus(id: string, status: TurnStatus, error: string | null): void {
      touch('turn_status = ?, turn_error = ?', status, error, id)
    },
    /** Al arrancar: ningún turno puede seguir en curso de una ejecución anterior. */
    interruptRunning(): void {
      db.prepare("UPDATE sessions SET turn_status = 'interrupted' WHERE turn_status = 'running'").run()
    },
  }
  return repo
}
