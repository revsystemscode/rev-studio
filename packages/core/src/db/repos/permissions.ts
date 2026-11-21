import { randomUUID } from 'node:crypto'
import type { PermissionRule } from '@rev/protocol'
import type { Db } from '../open'

const select = 'SELECT id, project_id AS projectId, tool_name AS toolName, pattern FROM permissions'

export function permissionsRepo(db: Db) {
  return {
    list(projectId: string): PermissionRule[] {
      return db.prepare(`${select} WHERE project_id = ? ORDER BY tool_name, pattern`).all(projectId) as unknown as PermissionRule[]
    },
    add(projectId: string, toolName: string, pattern: string): PermissionRule {
      db.prepare('INSERT OR IGNORE INTO permissions (id, project_id, tool_name, pattern) VALUES (?, ?, ?, ?)').run(
        randomUUID(),
        projectId,
        toolName,
        pattern,
      )
      return db
        .prepare(`${select} WHERE project_id = ? AND tool_name = ? AND pattern = ?`)
        .get(projectId, toolName, pattern) as unknown as PermissionRule
    },
    remove(id: string): void {
      db.prepare('DELETE FROM permissions WHERE id = ?').run(id)
    },
  }
}
