import type { CoreEvent, Project, ProviderStatus, Session, Settings } from '@rev/protocol'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { CoreClient } from '../client'

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

  /** Carga proyectos, sesiones, proveedores y ajustes. Se llama de nuevo cuando el core se reinicia. */
  init(client: CoreClient): Promise<void>
  refreshProviders(): Promise<void>
  addProject(): Promise<void>
  removeProject(id: string): Promise<void>
  relocateProject(id: string): Promise<void>
  /** Usa el modelo por defecto de los ajustes o, si no hay, el primero disponible. */
  createSession(projectId: string): Promise<void>
  deleteSession(id: string): Promise<void>
  selectSession(projectId: string, sessionId: string): void
  setDefaultModel(choice: { providerId: string; model: string } | null): Promise<void>
  setView(view: AppState['view']): void
  dismissNotice(): void
  applyEvent(e: CoreEvent): void
}

export interface AppStoreDeps {
  pickFolder(): Promise<string | null>
}

const NO_MODEL = 'No hay ningún modelo disponible. Revisa los proveedores en Ajustes.'
const NOT_CONNECTED = 'Rev Studio todavía no está conectado con su motor.'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createAppStore(deps: AppStoreDeps) {
  return createStore<AppState>()((set, get) => {
    const core = (): CoreClient => {
      const { client } = get()
      if (!client) throw new Error(NOT_CONNECTED)
      return client
    }
    /** Ejecuta una acción; si falla, deja el motivo en `notice` en vez de propagar el error a la interfaz. */
    const attempt = async (action: () => Promise<void>) => {
      try {
        await action()
      } catch (e) {
        set({ notice: message(e) })
      }
    }
    const upsertProject = (project: Project) =>
      set((s) => ({
        projects: s.projects.some((p) => p.id === project.id)
          ? s.projects.map((p) => (p.id === project.id ? project : p))
          : [...s.projects, project],
        sessionsByProject: { [project.id]: [], ...s.sessionsByProject },
        activeProjectId: project.id,
      }))

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

      async init(client) {
        set({ client })
        await attempt(async () => {
          const [projects, providers, settings] = await Promise.all([
            client.call('projects.list', {}),
            client.call('providers.list', {}),
            client.call('settings.get', {}),
          ])
          const lists = await Promise.all(projects.map((p) => client.call('sessions.list', { projectId: p.id })))
          // Un core reiniciado mientras cargábamos ya trae su propio cliente: este resultado está caducado.
          if (get().client !== client) return
          const sessionsByProject = Object.fromEntries(projects.map((p, i) => [p.id, lists[i] ?? []]))
          const { activeProjectId, activeSessionId } = get()
          const projectAlive = projects.some((p) => p.id === activeProjectId)
          const sessionAlive = projectAlive && (sessionsByProject[activeProjectId!] ?? []).some((s) => s.id === activeSessionId)
          set({
            ready: true,
            projects,
            sessionsByProject,
            providers,
            settings,
            // Las aprobaciones en curso no sobreviven a un reinicio del core.
            pendingApprovals: {},
            activeProjectId: projectAlive ? activeProjectId : null,
            activeSessionId: sessionAlive ? activeSessionId : null,
          })
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
          set((s) => {
            const { [id]: removed, ...sessionsByProject } = s.sessionsByProject
            const wasActive = s.activeProjectId === id
            return {
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
          set((s) => ({
            sessionsByProject: { ...s.sessionsByProject, [projectId]: [session, ...(s.sessionsByProject[projectId] ?? [])] },
            activeProjectId: projectId,
            activeSessionId: session.id,
            view: 'main',
          }))
        }),

      deleteSession: (id) =>
        attempt(async () => {
          await core().call('sessions.delete', { id })
          set((s) => {
            const { [id]: gone, ...pendingApprovals } = s.pendingApprovals
            return {
              sessionsByProject: Object.fromEntries(
                Object.entries(s.sessionsByProject).map(([pid, list]) => [pid, list.filter((x) => x.id !== id)]),
              ),
              pendingApprovals,
              activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
            }
          })
        }),

      selectSession: (projectId, sessionId) => set({ activeProjectId: projectId, activeSessionId: sessionId, view: 'main' }),

      setDefaultModel: (choice) =>
        attempt(async () => {
          const settings: Settings = { defaultProviderId: choice?.providerId ?? null, defaultModel: choice?.model ?? null }
          await core().call('settings.set', settings)
          set({ settings })
        }),

      setView: (view) => set({ view }),
      dismissNotice: () => set({ notice: null }),

      applyEvent(e) {
        if (e.type === 'turn.status') {
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
