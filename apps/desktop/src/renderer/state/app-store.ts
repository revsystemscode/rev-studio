import type { ApprovalDecision, ChangedFile, CoreEvent, DirEntry, Project, ProviderStatus, Session, Settings } from '@rev/protocol'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { CoreClient } from '../client'
import { emptyView, fromSnapshot, reduceSession, type SessionView } from './session-state'

export interface AppState {
  client: CoreClient | null
  /** Falso hasta que termina la primera carga desde el core. */
  ready: boolean
  projects: Project[]
  sessionsByProject: Record<string, Session[]>
  providers: ProviderStatus[]
  settings: Settings
  activeProjectId: string | null
  activeSessionId: string | null
  view: 'main' | 'settings'
  /** Ids de las aprobaciones pendientes de cada sesión; solo aparecen las sesiones que tienen alguna. */
  pendingApprovals: Record<string, string[]>
  /** Aviso para el usuario cuando una acción falla. */
  notice: string | null
  /** Vistas del chat de las sesiones abiertas en esta ventana. */
  sessionViews: Record<string, SessionView>
  /** Carpetas cargadas del árbol: proyecto → carpeta ('' es la raíz) → entradas. */
  treeByProject: Record<string, Record<string, DirEntry[]>>
  /** Archivo abierto en el editor. `content` es lo último leído o guardado en disco. */
  openFile: OpenFile | null
  /** Sube con cada recarga explícita, para que el editor descarte su contenido. */
  fileReloads: number
  openDiff: { sessionId: string; path: string; original: string | null; current: string | null } | null
  /** Por qué no se pudo abrir el último archivo pedido (demasiado grande, binario…). */
  editorError: { path: string; message: string } | null
  changesBySession: Record<string, ChangedFile[]>
  /** Pregunta pendiente: abrir otra cosa descartaría los cambios sin guardar de `path`. */
  discardPrompt: { path: string } | null

  /** Carga proyectos, sesiones, proveedores y ajustes. Se llama de nuevo cuando el core se reinicia. */
  init(client: CoreClient): Promise<void>
  refreshProviders(): Promise<boolean>
  addProject(): Promise<boolean>
  removeProject(id: string): Promise<boolean>
  relocateProject(id: string): Promise<boolean>
  /** Usa el modelo por defecto de los ajustes o, si no hay, el primero disponible. */
  createSession(projectId: string): Promise<boolean>
  deleteSession(id: string): Promise<boolean>
  /** Selecciona la sesión y carga su vista desde el core. */
  selectSession(projectId: string, sessionId: string): Promise<void>
  setSessionModel(sessionId: string, choice: { providerId: string; model: string }): Promise<boolean>
  /** Falso si el core no aceptó el mensaje (el motivo queda en `notice`). */
  sendMessage(sessionId: string, text: string): Promise<boolean>
  stopTurn(sessionId: string): Promise<boolean>
  retryTurn(sessionId: string): Promise<boolean>
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>
  setDefaultModel(choice: { providerId: string; model: string } | null): Promise<boolean>
  loadDir(projectId: string, dir: string): Promise<void>
  openPath(projectId: string, path: string): Promise<void>
  setDraft(text: string): void
  /** Hay texto sin guardar: cerrar la ventana debe pedir confirmación. */
  hasUnsavedChanges(): boolean
  saveOpenFile(content: string): Promise<boolean>
  reloadOpenFile(): Promise<void>
  closeEditor(): void
  /** Ejecuta `proceed` si no hay cambios sin guardar; si los hay, lo deja pendiente de confirmación. */
  guardUnsaved(proceed: () => void): void
  answerDiscard(discard: boolean): void
  refreshChanges(sessionId: string): Promise<void>
  showDiff(sessionId: string, path: string): Promise<void>
  revertFile(sessionId: string, path: string): Promise<boolean>
  setView(view: AppState['view']): void
  dismissNotice(): void
  applyEvent(e: CoreEvent): void
}

export interface OpenFile {
  projectId: string
  path: string
  content: string
  /** Texto actual del editor. Vive aquí para no perderse si el editor se desmonta (Ajustes, otro proyecto…). */
  draft: string
  dirty: boolean
  /** El archivo cambió en disco mientras tenía cambios sin guardar. */
  diskChanged: boolean
}

export interface AppStoreDeps {
  pickFolder(): Promise<string | null>
}

const NO_MODEL = 'No hay ningún modelo disponible. Revisa los proveedores en Ajustes.'
const NOT_CONNECTED = 'Rev Studio todavía no está conectado con su motor.'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** El core llama '' a la raíz en sus eventos y '.' en sus peticiones. */
const dirKey = (dir: string) => (dir === '.' || dir === '/' ? '' : dir)
const parentDir = (path: string) => path.split('/').slice(0, -1).join('/')

export function createAppStore(deps: AppStoreDeps) {
  return createStore<AppState>()((set, get) => {
    const core = (): CoreClient => {
      const { client } = get()
      if (!client) throw new Error(NOT_CONNECTED)
      return client
    }
    /** Ejecuta una acción; si falla, deja el motivo en `notice` en vez de propagar el error a la interfaz. */
    const attempt = async (action: () => Promise<void>): Promise<boolean> => {
      try {
        await action()
        return true
      } catch (e) {
        set({ notice: message(e) })
        return false
      }
    }
    /**
     * Cuenta los cambios hechos por acciones del usuario. `init` vuelve a cargar si cambia mientras
     * espera al core: su respuesta se pidió antes y pisaría lo que el usuario acaba de hacer.
     */
    let changes = 0
    /** Acción que espera a que el usuario confirme descartar cambios sin guardar. */
    let pendingDiscard: (() => void) | null = null
    const replaceSession = (session: Session) =>
      set((s) => ({
        sessionsByProject: {
          ...s.sessionsByProject,
          [session.projectId]: (s.sessionsByProject[session.projectId] ?? []).map((x) => (x.id === session.id ? session : x)),
        },
      }))
    /** Carga la vista de una sesión y sus aprobaciones pendientes. */
    const loadView = async (client: CoreClient, sessionId: string) => {
      const snapshot = await client.call('sessions.get', { id: sessionId })
      if (get().client !== client) return
      replaceSession(snapshot.session)
      set((s) => {
        const { [sessionId]: old, ...rest } = s.pendingApprovals
        const ids = snapshot.pendingApprovals.map((a) => a.id)
        return {
          sessionViews: { ...s.sessionViews, [sessionId]: fromSnapshot(snapshot) },
          pendingApprovals: ids.length ? { ...rest, [sessionId]: ids } : rest,
        }
      })
    }
    /** El core cambia el título al recibir el primer mensaje sin avisar: se vuelve a pedir la lista. */
    const refreshSessions = async (projectId: string) => {
      const client = get().client
      if (!client) return
      const list = await client.call('sessions.list', { projectId }).catch(() => null)
      if (list && get().client === client) set((s) => ({ sessionsByProject: { ...s.sessionsByProject, [projectId]: list } }))
    }

    /** Vuelve a leer el archivo abierto: lo sustituye si no tiene cambios sin guardar; si los tiene, avisa. */
    const checkOpenFile = async (projectId: string, path: string) => {
      const client = get().client
      const open = get().openFile
      if (!client || !open || open.projectId !== projectId || open.path !== path) return
      let content: string | null
      try {
        content = (await client.call('fs.read', { projectId, path })).content
      } catch {
        content = null
      }
      const now = get().openFile
      if (!now || now.projectId !== projectId || now.path !== path || content === now.content) return
      if (now.dirty) set({ openFile: { ...now, diskChanged: true } })
      else if (content === null) set({ openFile: null, editorError: { path, message: 'El archivo ya no está en el disco.' } })
      else set({ openFile: { ...now, content, draft: content, diskChanged: false } })
    }
    const projectOfSession = (sessionId: string) =>
      Object.entries(get().sessionsByProject).find(([, list]) => list.some((x) => x.id === sessionId))?.[0] ?? null

    const upsertProject = (project: Project) => {
      changes++
      set((s) => ({
        projects: s.projects.some((p) => p.id === project.id)
          ? s.projects.map((p) => (p.id === project.id ? project : p))
          : [...s.projects, project],
        sessionsByProject: { [project.id]: [], ...s.sessionsByProject },
        activeProjectId: project.id,
      }))
    }

    return {
      client: null,
      ready: false,
      projects: [],
      sessionsByProject: {},
      providers: [],
      settings: { defaultProviderId: null, defaultModel: null },
      activeProjectId: null,
      activeSessionId: null,
      view: 'main',
      pendingApprovals: {},
      notice: null,
      sessionViews: {},
      treeByProject: {},
      openFile: null,
      fileReloads: 0,
      openDiff: null,
      editorError: null,
      changesBySession: {},
      discardPrompt: null,

      async init(client) {
        set({ client })
        await attempt(async () => {
          const load = async () => {
            const [projects, providers, settings] = await Promise.all([
              client.call('projects.list', {}),
              client.call('providers.list', {}),
              client.call('settings.get', {}),
            ])
            const lists = await Promise.all(projects.map((p) => client.call('sessions.list', { projectId: p.id })))
            return { projects, providers, settings, lists }
          }
          let before = changes
          let loaded = await load()
          for (let tries = 0; changes !== before && tries < 5; tries++) {
            before = changes
            loaded = await load()
          }
          const { projects, providers, settings, lists } = loaded
          // Un core reiniciado mientras cargábamos ya trae su propio cliente: este resultado está caducado.
          if (get().client !== client) return
          const sessionsByProject = Object.fromEntries(projects.map((p, i) => [p.id, lists[i] ?? []]))
          const { activeProjectId, activeSessionId } = get()
          const projectAlive = projects.some((p) => p.id === activeProjectId)
          const sessionAlive = projectAlive && (sessionsByProject[activeProjectId!] ?? []).some((s) => s.id === activeSessionId)
          const alive = new Set(Object.values(sessionsByProject).flat().map((x) => x.id))
          const reload = Object.keys(get().sessionViews).filter((id) => alive.has(id))
          set({
            ready: true,
            projects,
            sessionsByProject,
            providers,
            settings,
            pendingApprovals: {},
            sessionViews: Object.fromEntries(Object.entries(get().sessionViews).filter(([id]) => alive.has(id))),
            activeProjectId: projectAlive ? activeProjectId : null,
            activeSessionId: sessionAlive ? activeSessionId : null,
          })
          // Tras un reinicio del core, lo que mostraban las vistas puede haber cambiado.
          await Promise.all(reload.map((id) => loadView(client, id)))
        })
      },

      refreshProviders: () =>
        attempt(async () => {
          set({ providers: await core().call('providers.list', {}) })
        }),

      addProject: () =>
        attempt(async () => {
          const path = await deps.pickFolder()
          if (!path) return
          upsertProject(await core().call('projects.add', { path }))
        }),

      removeProject: (id) =>
        attempt(async () => {
          await core().call('projects.remove', { id })
          changes++
          set((s) => {
            const { [id]: removed, ...sessionsByProject } = s.sessionsByProject
            const wasActive = s.activeProjectId === id
            const { [id]: goneTree, ...treeByProject } = s.treeByProject
            return {
              treeByProject,
              openFile: s.openFile?.projectId === id ? null : s.openFile,
              projects: s.projects.filter((p) => p.id !== id),
              sessionsByProject,
              activeProjectId: wasActive ? null : s.activeProjectId,
              activeSessionId: wasActive ? null : s.activeSessionId,
            }
          })
        }),

      relocateProject: (id) =>
        attempt(async () => {
          const path = await deps.pickFolder()
          if (!path) return
          upsertProject(await core().call('projects.relocate', { id, path }))
        }),

      createSession: (projectId) =>
        attempt(async () => {
          const client = core()
          const { settings, providers } = get()
          let target =
            settings.defaultProviderId && settings.defaultModel
              ? { providerId: settings.defaultProviderId, model: settings.defaultModel }
              : null
          if (!target) {
            for (const { config, reachable } of providers) {
              if (!reachable) continue
              const models = await client.call('providers.models', { providerId: config.id }).catch(() => [])
              if (models[0]) {
                target = { providerId: config.id, model: models[0] }
                break
              }
            }
          }
          if (!target) {
            set({ notice: NO_MODEL })
            return
          }
          const session = await client.call('sessions.create', { projectId, ...target })
          changes++
          set((s) => ({
            sessionsByProject: { ...s.sessionsByProject, [projectId]: [session, ...(s.sessionsByProject[projectId] ?? [])] },
            sessionViews: { ...s.sessionViews, [session.id]: emptyView(session.id) },
            activeProjectId: projectId,
            activeSessionId: session.id,
            view: 'main',
          }))
        }),

      deleteSession: (id) =>
        attempt(async () => {
          await core().call('sessions.delete', { id })
          changes++
          set((s) => {
            const { [id]: gone, ...pendingApprovals } = s.pendingApprovals
            const { [id]: goneView, ...sessionViews } = s.sessionViews
            const { [id]: goneChanges, ...changesBySession } = s.changesBySession
            return {
              sessionViews,
              changesBySession,
              openDiff: s.openDiff?.sessionId === id ? null : s.openDiff,
              sessionsByProject: Object.fromEntries(
                Object.entries(s.sessionsByProject).map(([pid, list]) => [pid, list.filter((x) => x.id !== id)]),
              ),
              pendingApprovals,
              activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
            }
          })
        }),

      async selectSession(projectId, sessionId) {
        // El diff y los errores son de la sesión anterior; el archivo abierto (y su borrador) se conserva.
        const leaving = get().activeSessionId !== sessionId
        set({
          activeProjectId: projectId,
          activeSessionId: sessionId,
          view: 'main',
          ...(leaving && { openDiff: null, editorError: null }),
        })
        void get().refreshChanges(sessionId)
        if (get().sessionViews[sessionId]) return
        await attempt(() => loadView(core(), sessionId))
      },

      async loadDir(projectId, dir) {
        const key = dirKey(dir)
        try {
          const entries = await core().call('fs.list', { projectId, dir: key || '.' })
          set((s) => ({ treeByProject: { ...s.treeByProject, [projectId]: { ...s.treeByProject[projectId], [key]: entries } } }))
        } catch (e) {
          // Una carpeta que ya no existe sale del árbol; si nunca se cargó, se avisa.
          const tree = get().treeByProject[projectId]
          if (tree && key in tree) {
            const { [key]: gone, ...rest } = tree
            set((s) => ({ treeByProject: { ...s.treeByProject, [projectId]: rest } }))
          } else {
            set({ notice: message(e) })
          }
        }
      },

      async openPath(projectId, path) {
        try {
          const { content } = await core().call('fs.read', { projectId, path })
          set({ openFile: { projectId, path, content, draft: content, dirty: false, diskChanged: false }, openDiff: null, editorError: null })
        } catch (e) {
          // Demasiado grande, binario o desaparecido: se explica en el panel del editor, no como aviso global.
          set({ openFile: null, openDiff: null, editorError: { path, message: message(e) } })
        }
      },

      setDraft(text) {
        const open = get().openFile
        if (open && open.draft !== text) set({ openFile: { ...open, draft: text, dirty: text !== open.content } })
      },

      hasUnsavedChanges: () => Boolean(get().openFile?.dirty),

      saveOpenFile: (content) =>
        attempt(async () => {
          const open = get().openFile
          if (!open) return
          await core().call('fs.write', { projectId: open.projectId, path: open.path, content })
          const now = get().openFile
          if (now?.projectId === open.projectId && now.path === open.path) {
            // Lo escrito después de pulsar guardar sigue siendo un borrador.
            set({ openFile: { ...now, content, dirty: now.draft !== content, diskChanged: false } })
          }
        }),

      async reloadOpenFile() {
        const open = get().openFile
        if (!open) return
        await get().openPath(open.projectId, open.path)
        set((s) => ({ fileReloads: s.fileReloads + 1 }))
      },

      closeEditor: () => set({ openFile: null, openDiff: null, editorError: null }),

      guardUnsaved(proceed) {
        const open = get().openFile
        if (!open?.dirty) {
          proceed()
          return
        }
        pendingDiscard = proceed
        set({ discardPrompt: { path: open.path } })
      },
      answerDiscard(discard) {
        const proceed = pendingDiscard
        pendingDiscard = null
        set({ discardPrompt: null })
        if (discard) proceed?.()
      },

      async refreshChanges(sessionId) {
        const client = get().client
        if (!client) return
        try {
          const list = await client.call('changes.list', { sessionId })
          if (get().client === client) set((s) => ({ changesBySession: { ...s.changesBySession, [sessionId]: list } }))
        } catch {
          // Sesión borrada o core reiniciándose: la lista se vuelve a pedir en la próxima ocasión.
        }
      },

      async showDiff(sessionId, path) {
        try {
          const { original, current } = await core().call('changes.diff', { sessionId, path })
          set({ openDiff: { sessionId, path, original, current }, openFile: null, editorError: null })
        } catch (e) {
          set({ openDiff: null, openFile: null, editorError: { path, message: message(e) } })
        }
      },

      revertFile: (sessionId, path) =>
        attempt(async () => {
          await core().call('changes.revert', { sessionId, path })
          if (get().openDiff?.sessionId === sessionId && get().openDiff?.path === path) set({ openDiff: null })
          await get().refreshChanges(sessionId)
        }),

      setSessionModel: (sessionId, choice) =>
        attempt(async () => {
          replaceSession(await core().call('sessions.setModel', { id: sessionId, ...choice }))
        }),

      sendMessage: (sessionId, text) =>
        attempt(async () => {
          await core().call('turn.send', { sessionId, text })
        }),
      stopTurn: (sessionId) =>
        attempt(async () => {
          await core().call('turn.stop', { sessionId })
        }),
      retryTurn: (sessionId) =>
        attempt(async () => {
          await core().call('turn.retry', { sessionId })
        }),
      resolveApproval: (approvalId, decision) =>
        attempt(async () => {
          await core().call('approval.resolve', { approvalId, decision })
        }),

      setDefaultModel: (choice) =>
        attempt(async () => {
          const settings: Settings = { defaultProviderId: choice?.providerId ?? null, defaultModel: choice?.model ?? null }
          await core().call('settings.set', settings)
          changes++
          set({ settings })
        }),

      setView: (view) => set({ view }),
      dismissNotice: () => set({ notice: null }),

      applyEvent(e) {
        if (e.type === 'tree.changed') {
          const key = dirKey(e.dir)
          if (get().treeByProject[e.projectId]?.[key]) void get().loadDir(e.projectId, key)
          const open = get().openFile
          if (open?.projectId === e.projectId && parentDir(open.path) === key) void checkOpenFile(open.projectId, open.path)
        }
        if (e.type === 'file.changed') {
          if (e.sessionId === get().activeSessionId) void get().refreshChanges(e.sessionId)
          const open = get().openFile
          if (open?.path === e.path && open.projectId === projectOfSession(e.sessionId)) void checkOpenFile(open.projectId, open.path)
          const diff = get().openDiff
          if (diff?.sessionId === e.sessionId && diff.path === e.path) void get().showDiff(diff.sessionId, diff.path)
        }
        if ('sessionId' in e) {
          const view = get().sessionViews[e.sessionId]
          if (view) {
            const next = reduceSession(view, e)
            if (next !== view) set((s) => ({ sessionViews: { ...s.sessionViews, [e.sessionId]: next } }))
          }
        }
        if (e.type === 'turn.status') {
          if (e.status === 'running') {
            const owner = Object.entries(get().sessionsByProject).find(([, list]) => list.some((x) => x.id === e.sessionId))
            if (owner) void refreshSessions(owner[0])
          }
          set((s) => ({
            sessionsByProject: Object.fromEntries(
              Object.entries(s.sessionsByProject).map(([pid, list]) => [
                pid,
                list.map((x) => (x.id === e.sessionId ? { ...x, turnStatus: e.status, turnError: e.error } : x)),
              ]),
            ),
          }))
        } else if (e.type === 'approval.requested') {
          set((s) => {
            const current = s.pendingApprovals[e.sessionId] ?? []
            if (current.includes(e.approval.id)) return s
            return { pendingApprovals: { ...s.pendingApprovals, [e.sessionId]: [...current, e.approval.id] } }
          })
        } else if (e.type === 'approval.resolved') {
          set((s) => {
            const { [e.sessionId]: current = [], ...rest } = s.pendingApprovals
            const left = current.filter((id) => id !== e.approvalId)
            return { pendingApprovals: left.length ? { ...rest, [e.sessionId]: left } : rest }
          })
        }
      },
    }
  })
}

/** Store de la aplicación. `window.rev` solo se toca al usarlo, no al importar el módulo. */
export const appStore = createAppStore({ pickFolder: () => window.rev.pickFolder() })

export const useApp = <T>(selector: (state: AppState) => T): T => useStore(appStore, selector)
