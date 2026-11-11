// Utilidades de prueba: proyecto temporal en disco con base de datos en memoria.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { openDatabase, type Db } from '../db/open'
import { projectsRepo } from '../db/repos/projects'
import { sessionsRepo } from '../db/repos/sessions'
import { snapshotsRepo } from '../db/repos/snapshots'
import { SnapshotStore } from '../snapshots/store'
import type { ToolContext } from '../tools/types'

export interface TestProject {
  root: string
  db: Db
  projectId: string
  sessionId: string
  ctx: ToolContext
  changed: string[]
  abort: AbortController
  write(rel: string, content: string | Buffer): void
  cleanup(): void
}

const created: TestProject[] = []

/** `subdir` permite probar rutas con espacios y caracteres no ASCII. */
export function makeProject(files: Record<string, string | Buffer> = {}, subdir = 'proyecto'): TestProject {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rev-test-')))
  const root = join(base, subdir)
  mkdirSync(root, { recursive: true })
  const write = (rel: string, content: string | Buffer) => {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  for (const [rel, content] of Object.entries(files)) write(rel, content)

  const db = openDatabase(':memory:')
  const project = projectsRepo(db).add('demo', root)
  const session = sessionsRepo(db).create(project.id, 'fake', 'fake-model')
  const changed: string[] = []
  const abort = new AbortController()
  const ctx: ToolContext = {
    root,
    sessionId: session.id,
    signal: abort.signal,
    rgPath,
    snapshots: new SnapshotStore(snapshotsRepo(db), root, session.id),
    onFileChanged: (p) => changed.push(p),
  }
  const project_: TestProject = {
    root,
    db,
    projectId: project.id,
    sessionId: session.id,
    ctx,
    changed,
    abort,
    write,
    cleanup: () => {
      db.close()
      rmSync(base, { recursive: true, force: true })
    },
  }
  created.push(project_)
  return project_
}

export function cleanupProjects(): void {
  for (const p of created.splice(0)) p.cleanup()
}

export { rgPath }
