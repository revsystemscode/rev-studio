import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrations } from './migrations'
import { MigrationError, openDatabase } from './open'
import { messagesRepo } from './repos/messages'
import { permissionsRepo } from './repos/permissions'
import { projectsRepo } from './repos/projects'
import { providersRepo } from './repos/providers'
import { sessionsRepo } from './repos/sessions'
import { snapshotsRepo } from './repos/snapshots'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function seed() {
  const db = openDatabase(':memory:')
  const project = projectsRepo(db).add('demo', '/tmp/demo')
  const session = sessionsRepo(db).create(project.id, 'p1', 'm1')
  return { db, project, session }
}

function version(db: ReturnType<typeof openDatabase>): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

describe('database', () => {
  it('aplica las migraciones y deja user_version = migrations.length', () => {
    const db = openDatabase(':memory:')
    expect(version(db)).toBe(migrations.length)
    expect(projectsRepo(db).list()).toEqual([])
  })

  it('messages.append asigna seq consecutivo desde 1 por sesión y conserva parts', () => {
    const { db, project, session } = seed()
    const other = sessionsRepo(db).create(project.id, 'p1', 'm1')
    const repo = messagesRepo(db)
    const parts = [
      { type: 'text' as const, text: 'hola' },
      { type: 'tool-call' as const, callId: 'c1', name: 'read_file', input: { path: 'a.ts' } },
    ]
    const a = repo.append(session.id, 'user', parts)
    const b = repo.append(session.id, 'assistant', [])
    const c = repo.append(other.id, 'user', [])
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 1])
    expect(repo.list(session.id).map((m) => m.seq)).toEqual([1, 2])
    expect(repo.list(session.id)[0]!.parts).toEqual(parts)
    expect(a.coversUpToSeq).toBeNull()
    expect(repo.append(session.id, 'summary', [], 2).coversUpToSeq).toBe(2)
  })

  it('borrar un proyecto borra en cascada sesiones, mensajes, snapshots y permisos', () => {
    const { db, project, session } = seed()
    messagesRepo(db).append(session.id, 'user', [])
    snapshotsRepo(db).put(session.id, 'a.ts', 'x')
    permissionsRepo(db).add(project.id, 'edit_file', '*')
    projectsRepo(db).remove(project.id)
    expect(sessionsRepo(db).list(project.id)).toEqual([])
    expect(messagesRepo(db).list(session.id)).toEqual([])
    expect(snapshotsRepo(db).list(session.id)).toEqual([])
    expect(permissionsRepo(db).list(project.id)).toEqual([])
  })

  it('snapshots distingue archivo vacío de archivo que no existía', () => {
    const { db, session } = seed()
    const repo = snapshotsRepo(db)
    repo.put(session.id, 'nuevo.ts', null)
    repo.put(session.id, 'vacio.ts', '')
    expect(repo.get(session.id, 'nuevo.ts')).toEqual({ original: null })
    expect(repo.get(session.id, 'vacio.ts')).toEqual({ original: '' })
    expect(repo.get(session.id, 'otro.ts')).toBeUndefined()
    repo.remove(session.id, 'nuevo.ts')
    expect(repo.list(session.id)).toEqual([{ path: 'vacio.ts', original: '' }])
  })

  it('permissions.add repetido no duplica', () => {
    const { db, project } = seed()
    const repo = permissionsRepo(db)
    const first = repo.add(project.id, 'run_command', 'npm test')
    const second = repo.add(project.id, 'run_command', 'npm test')
    expect(second.id).toBe(first.id)
    expect(repo.list(project.id)).toHaveLength(1)
    repo.remove(first.id)
    expect(repo.list(project.id)).toEqual([])
  })

  it('sessions.interruptRunning solo afecta a las sesiones en running', () => {
    const { db, project, session } = seed()
    const repo = sessionsRepo(db)
    const idle = repo.create(project.id, 'p1', 'm1')
    const failed = repo.create(project.id, 'p1', 'm1')
    repo.setTurnStatus(session.id, 'running', null)
    repo.setTurnStatus(failed.id, 'failed', 'boom')
    repo.interruptRunning()
    expect(repo.get(session.id)!.turnStatus).toBe('interrupted')
    expect(repo.get(idle.id)!.turnStatus).toBe('idle')
    expect(repo.get(failed.id)).toMatchObject({ turnStatus: 'failed', turnError: 'boom' })
  })

  it('sessions: título por defecto, setTitle y setModel', () => {
    const { db, session } = seed()
    const repo = sessionsRepo(db)
    expect(session.title).toBe('Nueva sesión')
    repo.setTitle(session.id, 'Arreglar login')
    repo.setModel(session.id, 'p2', 'm2')
    expect(repo.get(session.id)).toMatchObject({ title: 'Arreglar login', providerId: 'p2', model: 'm2' })
  })

  it('providers: save inserta y actualiza; settings guarda y borra', () => {
    const db = openDatabase(':memory:')
    const repo = providersRepo(db)
    const row = { id: 'o', type: 'ollama' as const, name: 'Ollama', baseUrl: 'http://x', keyCipher: null, contextSize: null }
    repo.save(row)
    repo.save({ ...row, name: 'Local', keyCipher: 'abc', contextSize: 8192 })
    expect(repo.list()).toEqual([{ ...row, name: 'Local', keyCipher: 'abc', contextSize: 8192 }])
    repo.setSetting('k', 'v')
    expect(repo.getSetting('k')).toBe('v')
    repo.setSetting('k', null)
    expect(repo.getSetting('k')).toBeNull()
    repo.remove('o')
    expect(repo.get('o')).toBeUndefined()
  })

  it('una migración inválida lanza MigrationError, conserva la versión y deja copia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rev-db-'))
    dirs.push(dir)
    const file = join(dir, 'test.db')
    const db = openDatabase(file)
    projectsRepo(db).add('demo', '/tmp/demo')
    db.close()

    let error: unknown
    try {
      openDatabase(file, [...migrations, 'CREATE TABLE ok_before_failure (id TEXT); CREATE TABLE (;'])
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(MigrationError)
    const backup = (error as MigrationError).backupPath
    expect(backup).toBe(`${file}.bak-v${migrations.length}`)
    expect(existsSync(backup!)).toBe(true)

    const reopened = openDatabase(file)
    expect(version(reopened)).toBe(migrations.length)
    expect(projectsRepo(reopened).list()).toHaveLength(1)
    const leaked = reopened.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_before_failure'").get()
    expect(leaked).toBeUndefined()
    reopened.close()
  })

  it('un archivo nuevo no genera copia de seguridad', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rev-db-'))
    dirs.push(dir)
    const file = join(dir, 'new.db')
    openDatabase(file).close()
    expect(existsSync(`${file}.bak-v0`)).toBe(false)
  })
})
