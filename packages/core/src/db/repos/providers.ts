import type { ProviderType } from '@rev/protocol'
import type { Db } from '../open'

export interface ProviderRow {
  id: string
  type: ProviderType
  name: string
  baseUrl: string
  keyCipher: string | null
  contextSize: number | null
}

const select =
  'SELECT id, type, name, base_url AS baseUrl, key_cipher AS keyCipher, context_size AS contextSize FROM providers'

export function providersRepo(db: Db) {
  return {
    list(): ProviderRow[] {
      return db.prepare(`${select} ORDER BY rowid`).all().map((r) => ({ ...r })) as unknown as ProviderRow[]
    },
    get(id: string): ProviderRow | undefined {
      const row = db.prepare(`${select} WHERE id = ?`).get(id)
      return row && ({ ...row } as unknown as ProviderRow)
    },
    save(row: ProviderRow): ProviderRow {
      db.prepare(
        `INSERT INTO providers (id, type, name, base_url, key_cipher, context_size) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET type = excluded.type, name = excluded.name, base_url = excluded.base_url,
           key_cipher = excluded.key_cipher, context_size = excluded.context_size`,
      ).run(row.id, row.type, row.name, row.baseUrl, row.keyCipher, row.contextSize)
      return row
    },
    remove(id: string): void {
      db.prepare('DELETE FROM providers WHERE id = ?').run(id)
    },
    getSetting(key: string): string | null {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string | null } | undefined
      return row?.value ?? null
    },
    setSetting(key: string, value: string | null): void {
      if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
      else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
    },
  }
}
