import { copyFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { migrations as defaultMigrations } from './migrations'

export type Db = DatabaseSync

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly backupPath: string | null,
  ) {
    super(message)
    this.name = 'MigrationError'
  }
}

function userVersion(db: Db): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

/** Abre la base de datos y aplica las migraciones pendientes, cada una en su transacción. */
export function openDatabase(path: string, migrations: string[] = defaultMigrations): Db {
  const inMemory = path === ':memory:'
  const existed = !inMemory && existsSync(path)
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (!inMemory) db.exec('PRAGMA journal_mode = WAL')

  const current = userVersion(db)
  if (current >= migrations.length) return db

  let backupPath: string | null = null
  if (existed) {
    // Vuelca el WAL al archivo principal para que la copia esté completa.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    backupPath = `${path}.bak-v${current}`
    copyFileSync(path, backupPath)
  }

  for (let version = current; version < migrations.length; version++) {
    db.exec('BEGIN')
    try {
      db.exec(migrations[version]!)
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (cause) {
      db.exec('ROLLBACK')
      db.close()
      const detail = cause instanceof Error ? cause.message : String(cause)
      throw new MigrationError(`Falló la migración ${version + 1}: ${detail}`, backupPath)
    }
  }
  return db
}
