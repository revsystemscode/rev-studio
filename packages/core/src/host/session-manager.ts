import type { ApprovalDecision, CoreEvent } from '@rev/protocol'
import { compact, shouldCompact } from '../agent/compaction'
import { SessionRunner } from '../agent/runner'
import type { Db } from '../db/open'
import { messagesRepo } from '../db/repos/messages'
import { permissionsRepo } from '../db/repos/permissions'
import { projectsRepo } from '../db/repos/projects'
import { providersRepo } from '../db/repos/providers'
import { sessionsRepo } from '../db/repos/sessions'
import { snapshotsRepo } from '../db/repos/snapshots'
import { PermissionService } from '../permissions/service'
import { createProvider } from '../providers/registry'
import type { Provider } from '../providers/types'
import { SnapshotStore } from '../snapshots/store'
import { CoreError, notFound } from './errors'

interface Entry {
  runner: SessionRunner
  projectId: string
  providerId: string
  contextWindow: number | null
}

export interface ManagerOptions {
  db: Db
  rgPath: string
  emit(event: CoreEvent): void
  decrypt(cipher: string): Promise<string>
  fakeScriptPath?: string
}

/** Dueño de los proveedores instanciados y de un SessionRunner por sesión activa. */
export class SessionManager {
  private readonly entries = new Map<string, Entry>()
  private readonly providers = new Map<string, Promise<Provider>>()
  /** Turno en curso de cada sesión, para poder esperar a que termine de escribir. */
  private readonly turns = new Map<string, Promise<void>>()
  private readonly projects
  private readonly sessions
  private readonly messages
  private readonly providerRows
  private readonly snapshotRows
  private readonly permissions

  constructor(private readonly opts: ManagerOptions) {
    this.projects = projectsRepo(opts.db)
    this.sessions = sessionsRepo(opts.db)
    this.messages = messagesRepo(opts.db)
    this.providerRows = providersRepo(opts.db)
    this.snapshotRows = snapshotsRepo(opts.db)
    this.permissions = new PermissionService(permissionsRepo(opts.db))
  }

  provider(providerId: string): Promise<Provider> {
    let cached = this.providers.get(providerId)
    if (!cached) {
      cached = (async () => {
        const row = this.providerRows.get(providerId)
        if (!row) throw notFound('el proveedor')
        const apiKey = row.keyCipher ? await this.opts.decrypt(row.keyCipher) : null
        return createProvider(row, apiKey, fetch, { fakeScriptPath: this.opts.fakeScriptPath })
      })()
      cached.catch(() => this.providers.delete(providerId))
      this.providers.set(providerId, cached)
    }
    return cached
  }

  /** Tras cambiar o borrar un proveedor: se descarta su instancia y los runners inactivos que la usan. */
  invalidateProvider(providerId: string): void {
    this.providers.delete(providerId)
    for (const [sessionId, entry] of this.entries) {
      if (entry.providerId === providerId && !entry.runner.running) this.entries.delete(sessionId)
    }
  }

  snapshots(sessionId: string): SnapshotStore {
    const session = this.sessions.get(sessionId)
    const project = session && this.projects.get(session.projectId)
    if (!session || !project) throw notFound('la sesión')
    return new SnapshotStore(this.snapshotRows, project.path, sessionId)
  }

  peek(sessionId: string): Entry | undefined {
    return this.entries.get(sessionId)
  }

  private async entry(sessionId: string): Promise<Entry> {
    const existing = this.entries.get(sessionId)
    if (existing) return existing

    const session = this.sessions.get(sessionId)
    const project = session && this.projects.get(session.projectId)
    if (!session || !project) throw notFound('la sesión')
    const provider = await this.provider(session.providerId)
    // Si el proveedor no responde ahora, el turno fallará con su propio mensaje; aquí solo falta la ventana.
    const contextWindow = await provider.getCapabilities(session.model).then((c) => c.contextWindow, () => null)
    const model = provider.createModel(session.model)

    // Otra petición pudo crear la entrada mientras se esperaba al proveedor.
    const raced = this.entries.get(sessionId)
    if (raced) return raced

    const runner: SessionRunner = new SessionRunner({
      sessionId,
      projectId: project.id,
      root: project.path,
      rgPath: this.opts.rgPath,
      model,
      contextWindow,
      messages: this.messages,
      sessions: this.sessions,
      permissions: this.permissions,
      snapshots: new SnapshotStore(this.snapshotRows, project.path, sessionId),
      emit: this.opts.emit,
      beforeStep: async (signal) => {
        if (!shouldCompact(runner.usedTokens, contextWindow)) return
        await compact({ sessionId, root: project.path, model, messages: this.messages, signal, emit: this.opts.emit })
      },
    })
    const entry: Entry = { runner, projectId: project.id, providerId: session.providerId, contextWindow }
    this.entries.set(sessionId, entry)
    return entry
  }

  private track(sessionId: string, turn: Promise<void>): void {
    this.turns.set(sessionId, turn)
    void turn.finally(() => {
      if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId)
    })
  }

  async send(sessionId: string, text: string): Promise<void> {
    const { runner } = await this.entry(sessionId)
    if (runner.running) throw new CoreError('invalid_params', 'Ya hay un turno en curso en esta sesión.')
    this.track(sessionId, runner.send(text))
  }

  async retry(sessionId: string): Promise<void> {
    const { runner } = await this.entry(sessionId)
    if (runner.running) throw new CoreError('invalid_params', 'Ya hay un turno en curso en esta sesión.')
    this.track(sessionId, runner.retry())
  }

  stop(sessionId: string): void {
    this.entries.get(sessionId)?.runner.stop()
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    for (const { runner } of this.entries.values()) {
      if (runner.pendingApprovals().some((a) => a.id === approvalId)) return runner.resolveApproval(approvalId, decision)
    }
    throw notFound('la aprobación')
  }

  isRunning(sessionId: string): boolean {
    return this.entries.get(sessionId)?.runner.running ?? false
  }

  /** Detiene el turno si lo hay, espera a que termine de escribir y olvida el runner. */
  async discard(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    entry.runner.stop()
    await this.turns.get(sessionId)
    this.entries.delete(sessionId)
  }

  async discardProject(projectId: string): Promise<void> {
    for (const [sessionId, entry] of [...this.entries]) {
      if (entry.projectId === projectId) await this.discard(sessionId)
    }
  }

  async stopAll(): Promise<void> {
    for (const { runner } of this.entries.values()) runner.stop()
    await Promise.allSettled([...this.turns.values()])
    this.entries.clear()
  }
}
