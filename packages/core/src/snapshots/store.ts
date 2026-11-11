import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChangedFile } from '@rev/protocol'
import type { snapshotsRepo } from '../db/repos/snapshots'
import { resolveInRoot, toRel } from '../tools/jail'
import { isErrno, ToolError } from '../tools/types'

async function readOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8')
  } catch (e) {
    if (isErrno(e, 'ENOENT')) return null
    throw e
  }
}

/** Guarda el contenido original de cada archivo antes de su primera modificación en la sesión. */
export class SnapshotStore {
  constructor(
    private readonly repo: ReturnType<typeof snapshotsRepo>,
    private readonly root: string,
    private readonly sessionId: string,
  ) {}

  /** `absPath` debe venir de resolveInRoot. Solo la primera llamada por ruta guarda algo. */
  async captureBeforeWrite(absPath: string): Promise<void> {
    const rel = toRel(await resolveInRoot(this.root, '.'), absPath)
    if (this.repo.get(this.sessionId, rel)) return
    this.repo.put(this.sessionId, rel, await readOrNull(absPath))
  }

  async list(): Promise<ChangedFile[]> {
    const out: ChangedFile[] = []
    for (const { path: rel, original } of this.repo.list(this.sessionId)) {
      const current = await readOrNull(path.join(this.root, rel))
      if (current === original) continue
      out.push({ path: rel, status: original === null ? 'created' : current === null ? 'deleted' : 'modified' })
    }
    return out
  }

  async diff(relPath: string): Promise<{ original: string | null; current: string | null }> {
    const { abs, original } = await this.lookup(relPath)
    return { original, current: await readOrNull(abs) }
  }

  async revert(relPath: string): Promise<void> {
    const { abs, rel, original } = await this.lookup(relPath)
    if (original === null) {
      await rm(abs, { force: true })
    } else {
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, original)
    }
    this.repo.remove(this.sessionId, rel)
  }

  private async lookup(relPath: string) {
    const abs = await resolveInRoot(this.root, relPath)
    const rel = toRel(await resolveInRoot(this.root, '.'), abs)
    const snapshot = this.repo.get(this.sessionId, rel)
    if (!snapshot) throw new ToolError(`No hay cambios registrados para "${relPath}".`)
    return { abs, rel, original: snapshot.original }
  }
}
