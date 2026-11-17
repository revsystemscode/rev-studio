import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { CoreEvent, Project, ProviderConfig } from '@rev/protocol'
import { openDatabase } from '../db/open'
import { messagesRepo } from '../db/repos/messages'
import { permissionsRepo } from '../db/repos/permissions'
import { projectsRepo, type ProjectRow } from '../db/repos/projects'
import { providersRepo, type ProviderRow } from '../db/repos/providers'
import { sessionsRepo } from '../db/repos/sessions'
import { FAKE_MODEL } from '../providers/fake'
import { probeTools } from '../providers/probe'
import { DEFAULT_URLS } from '../providers/registry'
import { CoreError, notFound } from './errors'
import { listDirectory, readForUi, writeFromUi } from './fs-handlers'
import { createRouter, type Handlers } from './router'
import { SessionManager } from './session-manager'
import { ProjectWatcher } from './watcher'

export interface Transport {
  post(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): void
}

export interface CoreOptions {
  dbPath: string
  rgPath: string
  transport: Transport
  /** Descifra una clave de API guardada; lo implementa el proceso principal con el llavero del sistema. */
  decrypt(cipher: string): Promise<string>
  /**
   * Habilita el proveedor guionizado para pruebas de extremo a extremo. Con `asDefault`, pasa a ser
   * el modelo por defecto si no hay otro elegido, para que las pruebas no usen un Ollama real del equipo.
   */
  fake?: { scriptPath: string; asDefault?: boolean }
}

const isDirectory = (p: string) => existsSync(p) && statSync(p).isDirectory()

const toProject = (row: ProjectRow): Project => ({ ...row, available: isDirectory(row.path) })

const toConfig = (row: ProviderRow): ProviderConfig => ({
  id: row.id,
  type: row.type,
  name: row.name,
  baseUrl: row.baseUrl,
  hasKey: row.keyCipher !== null,
  contextSize: row.contextSize,
})

export async function startCore(opts: CoreOptions): Promise<{ dispose(): Promise<void> }> {
  const db = openDatabase(opts.dbPath)
  const projects = projectsRepo(db)
  const sessions = sessionsRepo(db)
  const messages = messagesRepo(db)
  const providers = providersRepo(db)
  const permissions = permissionsRepo(db)

  sessions.interruptRunning()
  if (providers.list().length === 0) {
    providers.save({ id: randomUUID(), type: 'ollama', name: 'Ollama', baseUrl: DEFAULT_URLS.ollama, keyCipher: null, contextSize: null })
    providers.save({ id: randomUUID(), type: 'lmstudio', name: 'LM Studio', baseUrl: DEFAULT_URLS.lmstudio, keyCipher: null, contextSize: null })
  }
  if (opts.fake && !providers.list().some((p) => p.type === 'fake')) {
    providers.save({ id: randomUUID(), type: 'fake', name: 'Pruebas', baseUrl: 'fake://', keyCipher: null, contextSize: null })
  }
  if (opts.fake?.asDefault && providers.getSetting('defaultModel') === null) {
    const fake = providers.list().find((p) => p.type === 'fake')!
    providers.setSetting('defaultProviderId', fake.id)
    providers.setSetting('defaultModel', FAKE_MODEL)
  }

  let disposed = false
  const emit = (event: CoreEvent) => {
    if (!disposed) opts.transport.post({ event })
  }
  const manager = new SessionManager({ db, rgPath: opts.rgPath, emit, decrypt: opts.decrypt, fakeScriptPath: opts.fake?.scriptPath })
  const watcher = new ProjectWatcher(emit)
  const toolSupport = new Map<string, 'yes' | 'no'>()

  const project = (id: string): ProjectRow => {
    const row = projects.get(id)
    if (!row) throw notFound('el proyecto')
    return row
  }
  const session = (id: string) => {
    const s = sessions.get(id)
    if (!s) throw notFound('la sesión')
    return s
  }
  const directory = async (p: string): Promise<string> => {
    if (!isDirectory(p)) throw new CoreError('invalid_params', 'La ruta no es una carpeta existente.')
    return realpath(p)
  }

  const handlers: Handlers = {
    'projects.list': () => projects.list().map(toProject),
    'projects.add': async ({ path: p }) => {
      const dir = await directory(p)
      return toProject(projects.getByPath(dir) ?? projects.add(path.basename(dir) || dir, dir))
    },
    'projects.remove': async ({ id }) => {
      await manager.discardProject(id)
      watcher.close(id)
      projects.remove(id)
      return {}
    },
    'projects.relocate': async ({ id, path: p }) => {
      project(id)
      const dir = await directory(p)
      await manager.discardProject(id)
      watcher.close(id)
      projects.setPath(id, dir)
      return toProject(project(id))
    },

    'sessions.list': ({ projectId }) => sessions.list(projectId),
    'sessions.create': ({ projectId, providerId, model }) => {
      project(projectId)
      return sessions.create(projectId, providerId, model)
    },
    'sessions.delete': async ({ id }) => {
      await manager.discard(id)
      sessions.remove(id)
      return {}
    },
    'sessions.setModel': async ({ id, providerId, model }) => {
      session(id)
      if (manager.isRunning(id)) throw new CoreError('invalid_params', 'No se puede cambiar de modelo con un turno en curso.')
      await manager.discard(id)
      sessions.setModel(id, providerId, model)
      return session(id)
    },
    'sessions.get': ({ id }) => {
      const entry = manager.peek(id)
      return {
        session: session(id),
        messages: messages.list(id),
        pendingApprovals: entry?.runner.pendingApprovals() ?? [],
        usedTokens: entry?.runner.usedTokens ?? 0,
        windowTokens: entry?.contextWindow ?? null,
      }
    },

    'turn.send': async ({ sessionId, text }) => {
      await manager.send(sessionId, text)
      return {}
    },
    'turn.stop': ({ sessionId }) => {
      manager.stop(sessionId)
      return {}
    },
    'turn.retry': async ({ sessionId }) => {
      await manager.retry(sessionId)
      return {}
    },
    'approval.resolve': ({ approvalId, decision }) => {
      manager.resolveApproval(approvalId, decision)
      return {}
    },

    'fs.list': async ({ projectId, dir }) => {
      const { path: root } = project(projectId)
      const entries = await listDirectory(root, dir)
      watcher.watch(projectId, root)
      return entries
    },
    'fs.read': ({ projectId, path: p }) => readForUi(project(projectId).path, p),
    'fs.write': async ({ projectId, path: p, content }) => {
      await writeFromUi(project(projectId).path, p, content)
      return {}
    },

    'changes.list': ({ sessionId }) => manager.snapshots(sessionId).list(),
    'changes.diff': ({ sessionId, path: p }) => manager.snapshots(sessionId).diff(p),
    'changes.revert': async ({ sessionId, path: p }) => {
      await manager.snapshots(sessionId).revert(p)
      emit({ type: 'file.changed', sessionId, path: p })
      return {}
    },

    'providers.list': () =>
      Promise.all(
        providers.list().map(async (row) => ({
          config: toConfig(row),
          reachable: await manager.provider(row.id).then((p) => p.ping(), () => false),
        })),
      ),
    'providers.save': ({ id, keyCipher, ...rest }) => {
      const existing = id ? providers.get(id) : undefined
      if (id && !existing) throw notFound('el proveedor')
      const row = providers.save({
        id: id ?? randomUUID(),
        ...rest,
        keyCipher: keyCipher === undefined ? (existing?.keyCipher ?? null) : keyCipher,
      })
      manager.invalidateProvider(row.id)
      for (const key of [...toolSupport.keys()]) if (key.startsWith(`${row.id}\n`)) toolSupport.delete(key)
      return toConfig(row)
    },
    'providers.remove': ({ id }) => {
      providers.remove(id)
      manager.invalidateProvider(id)
      return {}
    },
    'providers.models': async ({ providerId }) => (await manager.provider(providerId)).listModels(),
    'providers.capabilities': async ({ providerId, model }) => {
      const provider = await manager.provider(providerId)
      const caps = await provider.getCapabilities(model)
      if (caps.tools !== 'unknown') return caps
      // Sin dato del servidor: se comprueba con una llamada real, una sola vez por modelo.
      const key = `${providerId}\n${model}`
      let tools = toolSupport.get(key)
      if (!tools) {
        tools = await probeTools(provider.createModel(model))
        toolSupport.set(key, tools)
      }
      return { ...caps, tools }
    },

    'permissions.list': ({ projectId }) => permissions.list(projectId),
    'permissions.remove': ({ id }) => {
      permissions.remove(id)
      return {}
    },

    'settings.get': () => ({
      defaultProviderId: providers.getSetting('defaultProviderId'),
      defaultModel: providers.getSetting('defaultModel'),
    }),
    'settings.set': ({ defaultProviderId, defaultModel }) => {
      providers.setSetting('defaultProviderId', defaultProviderId)
      providers.setSetting('defaultModel', defaultModel)
      return {}
    },
  }

  const route = createRouter(handlers, (msg) => {
    if (!disposed) opts.transport.post(msg)
  })
  opts.transport.onMessage((msg) => void route(msg))

  return {
    async dispose() {
      await manager.stopAll()
      disposed = true
      watcher.closeAll()
      db.close()
    },
  }
}
