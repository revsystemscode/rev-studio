import type { MethodName, Project, ProviderStatus, Session, SessionSnapshot } from '@rev/protocol'
import { describe, expect, it } from 'vitest'
import { CoreCallError, type CoreClient } from '../client'
import { createAppStore } from './app-store'

const project = (id: string): Project => ({ id, name: id, path: `/tmp/${id}`, available: true })
const session = (id: string, projectId: string, over: Partial<Session> = {}): Session => ({
  id,
  projectId,
  title: 'Nueva sesión',
  providerId: 'ollama',
  model: 'qwen',
  turnStatus: 'idle',
  turnError: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})
const provider = (id: string, reachable: boolean): ProviderStatus => ({
  config: { id, type: 'ollama', name: id, baseUrl: 'http://x', hasKey: false, contextSize: null },
  reachable,
})

type Handlers = Partial<Record<MethodName, (params: any) => unknown>>

/** Core simulado: responde con los manejadores dados y apunta cada llamada. */
function setup(handlers: Handlers = {}, pickFolder: () => Promise<string | null> = async () => null) {
  const calls: [MethodName, any][] = []
  const all: Handlers = {
    'projects.list': () => [],
    'sessions.list': () => [],
    'providers.list': () => [],
    'settings.get': () => ({ defaultProviderId: null, defaultModel: null }),
    'changes.list': () => [],
    ...handlers,
  }
  const client = {
    call: async (method: MethodName, params: unknown) => {
      calls.push([method, params])
      const handler = all[method]
      if (!handler) throw new Error(`Llamada inesperada: ${method}`)
      return handler(params)
    },
  } as unknown as CoreClient
  const store = createAppStore({ pickFolder })
  return { store, client, calls, called: (m: MethodName) => calls.filter(([name]) => name === m).map(([, p]) => p) }
}

describe('app-store', () => {
  it('init carga proyectos, sus sesiones, proveedores y ajustes', async () => {
    const { store, client } = setup({
      'projects.list': () => [project('a'), project('b')],
      'sessions.list': ({ projectId }) => (projectId === 'a' ? [session('s1', 'a')] : []),
      'providers.list': () => [provider('ollama', true)],
      'settings.get': () => ({ defaultProviderId: 'ollama', defaultModel: 'qwen' }),
    })
    await store.getState().init(client)
    const state = store.getState()
    expect(state.projects.map((p) => p.id)).toEqual(['a', 'b'])
    expect(state.sessionsByProject).toEqual({ a: [session('s1', 'a')], b: [] })
    expect(state.providers).toEqual([provider('ollama', true)])
    expect(state.settings).toEqual({ defaultProviderId: 'ollama', defaultModel: 'qwen' })
    expect(state.ready).toBe(true)
  })

  it('addProject no hace nada si pickFolder devuelve null', async () => {
    const { store, client, called } = setup()
    await store.getState().init(client)
    await store.getState().addProject()
    expect(called('projects.add')).toEqual([])
    expect(store.getState().projects).toEqual([])
  })

  it('addProject añade la carpeta elegida y la deja activa, sin duplicarla', async () => {
    const { store, client, called } = setup({ 'projects.add': () => project('a') }, async () => '/tmp/a')
    await store.getState().init(client)
    await store.getState().addProject()
    await store.getState().addProject()
    expect(called('projects.add')).toEqual([{ path: '/tmp/a' }, { path: '/tmp/a' }])
    expect(store.getState().projects).toEqual([project('a')])
    expect(store.getState().activeProjectId).toBe('a')
  })

  it('createSession usa el modelo por defecto de los ajustes', async () => {
    const { store, client, called } = setup({
      'projects.list': () => [project('a')],
      'providers.list': () => [provider('ollama', true), provider('otro', true)],
      'settings.get': () => ({ defaultProviderId: 'otro', defaultModel: 'grande' }),
      'sessions.create': (p) => session('s1', p.projectId, { providerId: p.providerId, model: p.model }),
    })
    await store.getState().init(client)
    await store.getState().createSession('a')
    expect(called('sessions.create')).toEqual([{ projectId: 'a', providerId: 'otro', model: 'grande' }])
    expect(called('providers.models')).toEqual([])
    expect(store.getState().sessionsByProject.a?.map((s) => s.id)).toEqual(['s1'])
    expect(store.getState().activeSessionId).toBe('s1')
    expect(store.getState().activeProjectId).toBe('a')
  })

  it('createSession sin modelo por defecto usa el primer modelo del primer proveedor accesible', async () => {
    const { store, client, called } = setup({
      'projects.list': () => [project('a')],
      'providers.list': () => [provider('apagado', false), provider('vacio', true), provider('bueno', true)],
      'providers.models': ({ providerId }) => (providerId === 'bueno' ? ['m1', 'm2'] : []),
      'sessions.create': (p) => session('s1', p.projectId, { providerId: p.providerId, model: p.model }),
    })
    await store.getState().init(client)
    await store.getState().createSession('a')
    expect(called('providers.models')).toEqual([{ providerId: 'vacio' }, { providerId: 'bueno' }])
    expect(called('sessions.create')).toEqual([{ projectId: 'a', providerId: 'bueno', model: 'm1' }])
  })

  it('createSession sin ningún modelo disponible no crea nada y deja un aviso', async () => {
    const { store, client, called } = setup({
      'projects.list': () => [project('a')],
      'providers.list': () => [provider('apagado', false)],
    })
    await store.getState().init(client)
    await store.getState().createSession('a')
    expect(called('sessions.create')).toEqual([])
    expect(store.getState().notice).toMatch(/modelo/i)
  })

  it('applyEvent turn.status actualiza turnStatus de la sesión correcta', async () => {
    const { store, client } = setup({
      'projects.list': () => [project('a'), project('b')],
      'sessions.list': ({ projectId }) => (projectId === 'a' ? [session('s1', 'a'), session('s2', 'a')] : [session('s3', 'b')]),
    })
    await store.getState().init(client)
    store.getState().applyEvent({ type: 'turn.status', sessionId: 's2', status: 'failed', error: 'Sin conexión' })
    const byId = Object.fromEntries(Object.values(store.getState().sessionsByProject).flat().map((s) => [s.id, s]))
    expect(byId.s2).toMatchObject({ turnStatus: 'failed', turnError: 'Sin conexión' })
    expect(byId.s1).toMatchObject({ turnStatus: 'idle', turnError: null })
    expect(byId.s3).toMatchObject({ turnStatus: 'idle', turnError: null })
  })

  it('applyEvent lleva la cuenta de aprobaciones pendientes por sesión', async () => {
    const { store, client } = setup()
    await store.getState().init(client)
    const approval = { id: 'ap1', sessionId: 's1', callId: 'c1', toolName: 'run_command', preview: { kind: 'command' as const, command: 'ls', cwd: '/' } }
    store.getState().applyEvent({ type: 'approval.requested', sessionId: 's1', approval })
    expect(store.getState().pendingApprovals).toEqual({ s1: ['ap1'] })
    store.getState().applyEvent({ type: 'approval.resolved', sessionId: 's1', approvalId: 'ap1' })
    expect(store.getState().pendingApprovals).toEqual({})
  })

  it('removeProject quita el proyecto, sus sesiones y la selección', async () => {
    const { store, client } = setup({
      'projects.list': () => [project('a')],
      'sessions.list': () => [session('s1', 'a')],
      'projects.remove': () => ({}),
    })
    await store.getState().init(client)
    store.getState().selectSession('a', 's1')
    await store.getState().removeProject('a')
    expect(store.getState()).toMatchObject({ projects: [], sessionsByProject: {}, activeProjectId: null, activeSessionId: null })
  })

  const snapshot = (s: Session, over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
    session: s,
    messages: [],
    pendingApprovals: [],
    usedTokens: 0,
    windowTokens: null,
    ...over,
  })

  it('selectSession carga la vista de la sesión con sessions.get', async () => {
    const s1 = session('s1', 'a')
    const { store, client, called } = setup({
      'projects.list': () => [project('a')],
      'sessions.list': () => [s1],
      'sessions.get': () => snapshot(s1, { usedTokens: 900, windowTokens: 32768 }),
    })
    await store.getState().init(client)
    await store.getState().selectSession('a', 's1')
    expect(called('sessions.get')).toEqual([{ id: 's1' }])
    expect(store.getState().sessionViews.s1).toMatchObject({ sessionId: 's1', usedTokens: 900, windowTokens: 32768 })
  })

  it('applyEvent aplica el evento a la vista cargada y no crea vistas de sesiones sin cargar', async () => {
    const s1 = session('s1', 'a')
    const { store, client } = setup({
      'projects.list': () => [project('a')],
      'sessions.list': () => [s1],
      'sessions.get': () => snapshot(s1),
    })
    await store.getState().init(client)
    await store.getState().selectSession('a', 's1')
    store.getState().applyEvent({ type: 'text.delta', sessionId: 's1', delta: 'hola' })
    store.getState().applyEvent({ type: 'text.delta', sessionId: 's9', delta: 'nada' })
    expect(store.getState().sessionViews.s1?.streamingText).toBe('hola')
    expect(store.getState().sessionViews.s9).toBeUndefined()
  })

  it('al reconectar con el core se recargan las vistas cargadas', async () => {
    const s1 = session('s1', 'a')
    let used = 100
    const { store, client, called } = setup({
      'projects.list': () => [project('a')],
      'sessions.list': () => [s1],
      'sessions.get': () => snapshot(s1, { usedTokens: used }),
    })
    await store.getState().init(client)
    await store.getState().selectSession('a', 's1')
    used = 250
    await store.getState().init(client)
    expect(called('sessions.get')).toHaveLength(2)
    expect(store.getState().sessionViews.s1?.usedTokens).toBe(250)
  })

  it('turn.status running vuelve a pedir la lista de sesiones del proyecto para recoger el título nuevo', async () => {
    let title = 'Nueva sesión'
    const { store, client } = setup({
      'projects.list': () => [project('a')],
      // Como el core: el título y el estado se guardan antes de emitir turn.status.
      'sessions.list': () => [session('s1', 'a', { title, turnStatus: title === 'Nueva sesión' ? 'idle' : 'running' })],
    })
    await store.getState().init(client)
    title = 'arregla el flag'
    store.getState().applyEvent({ type: 'turn.status', sessionId: 's1', status: 'running', error: null })
    await new Promise((r) => setTimeout(r, 10))
    expect(store.getState().sessionsByProject.a?.[0]).toMatchObject({ title: 'arregla el flag', turnStatus: 'running' })
  })

  it('setSessionModel cambia el modelo de la sesión', async () => {
    const { store, client, called } = setup({
      'projects.list': () => [project('a')],
      'sessions.list': () => [session('s1', 'a')],
      'sessions.setModel': (p) => session('s1', 'a', { providerId: p.providerId, model: p.model }),
    })
    await store.getState().init(client)
    await store.getState().setSessionModel('s1', { providerId: 'otro', model: 'grande' })
    expect(called('sessions.setModel')).toEqual([{ id: 's1', providerId: 'otro', model: 'grande' }])
    expect(store.getState().sessionsByProject.a?.[0]).toMatchObject({ providerId: 'otro', model: 'grande' })
  })

  it('las acciones del turno llaman al core y un error queda como aviso', async () => {
    const { store, client, called } = setup({
      'turn.send': () => ({}),
      'turn.stop': () => ({}),
      'approval.resolve': () => ({}),
      'turn.retry': () => {
        throw new Error('Ya hay un turno en curso en esta sesión.')
      },
    })
    await store.getState().init(client)
    await store.getState().sendMessage('s1', 'hola')
    await store.getState().stopTurn('s1')
    await store.getState().resolveApproval('ap1', 'deny')
    await store.getState().retryTurn('s1')
    expect(called('turn.send')).toEqual([{ sessionId: 's1', text: 'hola' }])
    expect(called('turn.stop')).toEqual([{ sessionId: 's1' }])
    expect(called('approval.resolve')).toEqual([{ approvalId: 'ap1', decision: 'deny' }])
    expect(store.getState().notice).toMatch(/turno en curso/)
  })

  it('un proyecto añadido mientras init sigue cargando no se pierde', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let lists = 0
    const { store, client } = setup(
      {
        // La primera lista se pidió antes de añadir el proyecto y llega tarde; el core ya lo tiene.
        'projects.list': async () => (++lists === 1 ? (await gate, []) : [project('a')]),
        'projects.add': () => project('a'),
      },
      async () => '/tmp/a',
    )
    const loading = store.getState().init(client)
    await store.getState().addProject()
    release()
    await loading
    expect(store.getState().projects).toEqual([project('a')])
    expect(store.getState().activeProjectId).toBe('a')
  })

  describe('archivos y cambios', () => {
    const entry = (path: string, isDir = false) => ({ name: path.split('/').pop()!, path, isDir })
    const tick = () => new Promise((r) => setTimeout(r, 10))

    it('loadDir guarda las entradas por proyecto y carpeta; la raíz se pide como "."', async () => {
      const { store, client, called } = setup({ 'fs.list': ({ dir }) => (dir === '.' ? [entry('src', true)] : [entry('src/a.ts')]) })
      await store.getState().init(client)
      await store.getState().loadDir('p', '')
      await store.getState().loadDir('p', 'src')
      expect(called('fs.list')).toEqual([
        { projectId: 'p', dir: '.' },
        { projectId: 'p', dir: 'src' },
      ])
      expect(store.getState().treeByProject).toEqual({ p: { '': [entry('src', true)], src: [entry('src/a.ts')] } })
    })

    it('tree.changed recarga la carpeta solo si ya estaba cargada', async () => {
      const { store, client, called } = setup({ 'fs.list': () => [] })
      await store.getState().init(client)
      await store.getState().loadDir('p', 'src')
      store.getState().applyEvent({ type: 'tree.changed', projectId: 'p', dir: 'src' })
      store.getState().applyEvent({ type: 'tree.changed', projectId: 'p', dir: 'docs' })
      store.getState().applyEvent({ type: 'tree.changed', projectId: 'otro', dir: 'src' })
      await tick()
      expect(called('fs.list')).toEqual([
        { projectId: 'p', dir: 'src' },
        { projectId: 'p', dir: 'src' },
      ])
    })

    it('file.changed de la sesión activa llama a changes.list', async () => {
      const s1 = session('s1', 'a')
      const { store, client, called } = setup({
        'projects.list': () => [project('a')],
        'sessions.list': () => [s1, session('s2', 'a')],
        'sessions.get': () => snapshot(s1),
        'changes.list': () => [{ path: 'src/a.ts', status: 'modified' }],
      })
      await store.getState().init(client)
      await store.getState().selectSession('a', 's1')
      expect(called('changes.list')).toEqual([{ sessionId: 's1' }])
      store.getState().applyEvent({ type: 'file.changed', sessionId: 's1', path: 'src/a.ts' })
      store.getState().applyEvent({ type: 'file.changed', sessionId: 's2', path: 'src/b.ts' })
      await tick()
      expect(called('changes.list')).toEqual([{ sessionId: 's1' }, { sessionId: 's1' }])
      expect(store.getState().changesBySession.s1).toEqual([{ path: 'src/a.ts', status: 'modified' }])
    })

    it('openPath abre el archivo y cierra el diff', async () => {
      const { store, client } = setup({
        'fs.read': () => ({ content: 'hola' }),
        'changes.diff': () => ({ original: 'a', current: 'b' }),
      })
      await store.getState().init(client)
      await store.getState().showDiff('s1', 'x.ts')
      await store.getState().openPath('p', 'src/a.ts')
      expect(store.getState().openFile).toEqual({ projectId: 'p', path: 'src/a.ts', content: 'hola', dirty: false, diskChanged: false })
      expect(store.getState().openDiff).toBeNull()
    })

    it('openPath con error too_large guarda el mensaje de error y no abre el archivo', async () => {
      const { store, client } = setup({
        'fs.read': () => {
          throw new CoreCallError('too_large', 'Archivo demasiado grande para abrirlo (más de 2 MB).')
        },
      })
      await store.getState().init(client)
      await store.getState().openPath('p', 'grande.log')
      expect(store.getState().openFile).toBeNull()
      expect(store.getState().editorError).toEqual({ path: 'grande.log', message: 'Archivo demasiado grande para abrirlo (más de 2 MB).' })
      expect(store.getState().notice).toBeNull()
    })

    it('file.changed del archivo abierto lo recarga si no está dirty y no lo toca si lo está', async () => {
      let disk = 'v1'
      const s1 = session('s1', 'p')
      const { store, client } = setup({
        'projects.list': () => [project('p')],
        'sessions.list': () => [s1],
        'sessions.get': () => snapshot(s1),
        'fs.read': () => ({ content: disk }),
      })
      await store.getState().init(client)
      await store.getState().selectSession('p', 's1')
      await store.getState().openPath('p', 'src/a.ts')

      disk = 'v2'
      store.getState().applyEvent({ type: 'file.changed', sessionId: 's1', path: 'src/a.ts' })
      await tick()
      expect(store.getState().openFile).toMatchObject({ content: 'v2', dirty: false, diskChanged: false })

      store.getState().setOpenFileDirty(true)
      disk = 'v3'
      store.getState().applyEvent({ type: 'file.changed', sessionId: 's1', path: 'src/a.ts' })
      await tick()
      expect(store.getState().openFile).toMatchObject({ content: 'v2', dirty: true, diskChanged: true })

      await store.getState().reloadOpenFile()
      expect(store.getState().openFile).toMatchObject({ content: 'v3', dirty: false, diskChanged: false })
    })

    it('tree.changed de la carpeta del archivo abierto lo recarga solo si cambió en disco', async () => {
      let disk = 'v1'
      const { store, client, called } = setup({ 'fs.read': () => ({ content: disk }), 'fs.list': () => [] })
      await store.getState().init(client)
      await store.getState().openPath('p', 'src/a.ts')
      store.getState().applyEvent({ type: 'tree.changed', projectId: 'p', dir: 'src' })
      await tick()
      expect(called('fs.read')).toHaveLength(2)
      expect(store.getState().openFile?.content).toBe('v1')
      disk = 'v2'
      store.getState().applyEvent({ type: 'tree.changed', projectId: 'p', dir: '' })
      await tick()
      expect(called('fs.read')).toHaveLength(2)
      store.getState().applyEvent({ type: 'tree.changed', projectId: 'p', dir: 'src' })
      await tick()
      expect(store.getState().openFile?.content).toBe('v2')
    })

    it('saveOpenFile escribe el contenido y limpia dirty', async () => {
      const { store, client, called } = setup({ 'fs.read': () => ({ content: 'a' }), 'fs.write': () => ({}) })
      await store.getState().init(client)
      await store.getState().openPath('p', 'x.ts')
      store.getState().setOpenFileDirty(true)
      await store.getState().saveOpenFile('b')
      expect(called('fs.write')).toEqual([{ projectId: 'p', path: 'x.ts', content: 'b' }])
      expect(store.getState().openFile).toMatchObject({ content: 'b', dirty: false })
    })

    it('showDiff abre el diff; revertFile revierte, refresca la lista y cierra el diff de ese archivo', async () => {
      let changes = [{ path: 'src/a.ts', status: 'modified' as const }]
      const { store, client, called } = setup({
        'changes.diff': () => ({ original: 'false', current: 'true' }),
        'changes.list': () => changes,
        'changes.revert': () => {
          changes = []
          return {}
        },
      })
      await store.getState().init(client)
      await store.getState().showDiff('s1', 'src/a.ts')
      expect(store.getState().openDiff).toEqual({ sessionId: 's1', path: 'src/a.ts', original: 'false', current: 'true' })
      await store.getState().revertFile('s1', 'src/a.ts')
      expect(called('changes.revert')).toEqual([{ sessionId: 's1', path: 'src/a.ts' }])
      expect(store.getState().changesBySession.s1).toEqual([])
      expect(store.getState().openDiff).toBeNull()
    })

    it('guardUnsaved deja pasar sin cambios sin guardar y, si los hay, pide confirmación antes', async () => {
      const { store, client } = setup({ 'fs.read': () => ({ content: 'a' }) })
      await store.getState().init(client)
      const runs: string[] = []
      store.getState().guardUnsaved(() => runs.push('sin archivo'))
      await store.getState().openPath('p', 'x.ts')
      store.getState().guardUnsaved(() => runs.push('limpio'))
      store.getState().setOpenFileDirty(true)
      store.getState().guardUnsaved(() => runs.push('sucio'))
      expect(runs).toEqual(['sin archivo', 'limpio'])
      expect(store.getState().discardPrompt).toEqual({ path: 'x.ts' })
      store.getState().answerDiscard(false)
      expect(runs).toEqual(['sin archivo', 'limpio'])
      expect(store.getState().discardPrompt).toBeNull()
      store.getState().guardUnsaved(() => runs.push('sucio'))
      store.getState().answerDiscard(true)
      expect(runs).toEqual(['sin archivo', 'limpio', 'sucio'])
      expect(store.getState().discardPrompt).toBeNull()
    })
  })
})

