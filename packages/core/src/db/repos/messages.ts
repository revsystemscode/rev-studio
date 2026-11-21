import { randomUUID } from 'node:crypto'
import type { MessageRole, Part, StoredMessage } from '@rev/protocol'
import type { Db } from '../open'

interface Row {
  id: string
  session_id: string
  seq: number
  role: MessageRole
  parts: string
  covers_upto_seq: number | null
  created_at: number
}

export function messagesRepo(db: Db) {
  return {
    list(sessionId: string): StoredMessage[] {
      const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq').all(sessionId) as unknown as Row[]
      return rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        seq: r.seq,
        role: r.role,
        parts: JSON.parse(r.parts) as Part[],
        coversUpToSeq: r.covers_upto_seq,
        createdAt: r.created_at,
      }))
    },
    append(sessionId: string, role: MessageRole, parts: Part[], coversUpToSeq: number | null = null): StoredMessage {
      const id = randomUUID()
      const createdAt = Date.now()
      const { seq } = db
        .prepare(
          `INSERT INTO messages (id, session_id, seq, role, parts, covers_upto_seq, created_at)
           VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE session_id = ?), ?, ?, ?, ?)
           RETURNING seq`,
        )
        .get(id, sessionId, sessionId, role, JSON.stringify(parts), coversUpToSeq, createdAt) as { seq: number }
      return { id, sessionId, seq, role, parts, coversUpToSeq, createdAt }
    },
  }
}
