import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResponseSchema, type CoreEvent, type MethodName, type ParamsOf, type ResultOf } from '@rev/protocol'
import { rgPath } from '@vscode/ripgrep'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/open'
import { projectsRepo } from '../db/repos/projects'
import { sessionsRepo } from '../db/repos/sessions'
import type { StepEvent } from '../providers/types'
import { startCore } from './start'

const finish: StepEvent = { type: 'finish', inputTokens: 100, outputTokens: 10 }
const say = (text: string): StepEvent[] => [{ type: 'text', delta: text }, finish]
const callStep = (name: string, input: unknown, callId: string): StepEvent[] => [{ type: 'tool-call', callId, name, input }, finish]
const EDIT = callStep('edit_file', { path: 'src/auth.ts', oldText: 'false', newText: 'true' }, 'e1')

const disposers: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const d of disposers.splice(0).reverse()) await d()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  disposers.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

class CallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

async function boot(script: StepEvent[][] = [], opts: { dbPath?: string; decrypt?: (c: string) => Promise<string> } = {}) {
  const work = tempDir('rev-host-')
  const root = join(work, 'proyecto')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/auth.ts'), 'export const ok = false\n')
  const scriptPath = join(work, 'script.json')
  writeFileSync(scriptPath, JSON.stringify(script))

  const events: CoreEvent[] = []
  const pending = new Map<number, (msg: any) => void>()
  let receive: (msg: unknown) => void = () => {}
  let nextId = 0
  const core = await startCore({
    dbPath: opts.dbPath ?? ':memory:',
    rgPath,
    decrypt: opts.decrypt ?? (async (c) => c),
    fake: { scriptPath },
    transport: {
      post(msg: any) {
        if ('event' in msg) events.push(msg.event)
        else pending.get(msg.id)?.(msg)
      },
      onMessage(cb) {
        receive = cb
      },
    },
  })
  disposers.push(() => core.dispose())

  const raw = (msg: unknown) => receive(msg)
  const call = <M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, (msg) => {
        expect(ResponseSchema.safeParse(msg).success).toBe(true)
        if ('error' in msg) reject(new CallError(msg.error.code, msg.error.message))
        else resolve(msg.result)
      })
      receive({ id, method, params })
    })
  const waitFor = async <T extends CoreEvent['type']>(type: T, match: (e: Extract<CoreEvent, { type: T }>) => boolean = () => true) => {
    const deadline = Date.now() + 10_000
    for (;;) {
      const found = events.find((e) => e.type === type && match(e as never))
      if (found) return found as Extract<CoreEvent, { type: T }>
      if (Date.now() > deadline) throw new Error(`No llegó el evento ${type}`)
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  const openSession = async () => {
    const project = await call('projects.add', { path: root })
    const fake = (await call('providers.list', {})).find((p) => p.config.type === 'fake')!
    const session = await call('sessions.create', { projectId: project.id, providerId: fake.config.id, model: 'fake-model' })
    return { project, session, fakeId: fake.config.id }
  }
  const idle = (sessionId: string) => waitFor('turn.status', (e) => e.sessionId === sessionId && e.status !== 'running')
  return { root, work, events, call, raw, waitFor, openSession, idle, core }
}

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: CallError) => e.code)

describe('router', () => {
  it('método desconocido → not_found; parámetros inválidos → invalid_params', async () => {
    const h = await boot()
    expect(await code(h.call('nope.nope' as MethodName, {} as never))).toBe('not_found')
    expect(await code(h.call('turn.send', { sessionId: 's' } as never))).toBe('invalid_params')
    expect(await code(h.call('sessions.get', { id: 'no-existe' }))).toBe('not_found')
  })

  it('ignora mensajes que no son peticiones sin dejar de funcionar', async () => {
    const h = await boot()
    h.raw('basura')
    h.raw({ id: 'x' })
    expect(await h.call('projects.list', {})).toEqual([])
  })
})

describe('arranque', () => {
  it('siembra Ollama y LM Studio con sus URL locales, y el proveedor de pruebas si está habilitado', async () => {
    const h = await boot()
    const list = await h.call('providers.list', {})
    expect(list.map((p) => [p.config.type, p.config.baseUrl])).toEqual([
      ['ollama', 'http://localhost:11434'],
      ['lmstudio', 'http://localhost:1234/v1'],
      ['fake', 'fake://'],
    ])
    expect(list.find((p) => p.config.type === 'fake')!.reachable).toBe(true)
  })

  it('una sesión que quedó en running pasa a interrupted', async () => {
    const dbPath = join(tempDir('rev-db-'), 'app.db')
    const db = openDatabase(dbPath)
    const project = projectsRepo(db).add('demo', tempDir('rev-proj-'))
    const session = sessionsRepo(db).create(project.id, 'x', 'm')
    sessionsRepo(db).setTurnStatus(session.id, 'running', null)
    db.close()
    const h = await boot([], { dbPath })
    expect((await h.call('sessions.get', { id: session.id })).session.turnStatus).toBe('interrupted')
  })
})

describe('proyectos', () => {
  it('añadir dos veces la misma carpeta devuelve el mismo proyecto; una ruta que no es carpeta se rechaza', async () => {
    const h = await boot()
    const a = await h.call('projects.add', { path: h.root })
    const b = await h.call('projects.add', { path: h.root })
    expect(b).toEqual(a)
    expect(a).toMatchObject({ name: 'proyecto', path: h.root, available: true })
    expect(await code(h.call('projects.add', { path: join(h.root, 'src/auth.ts') }))).toBe('invalid_params')
    expect(await code(h.call('projects.add', { path: join(h.root, 'no-existe') }))).toBe('invalid_params')
  })

  it('marca available false si la carpeta desaparece y relocate lo corrige', async () => {
    const h = await boot()
    const project = await h.call('projects.add', { path: h.root })
    const moved = join(h.work, 'movido')
    rmSync(h.root, { recursive: true })
    expect((await h.call('projects.list', {}))[0]!.available).toBe(false)
    mkdirSync(moved)
    expect(await h.call('projects.relocate', { id: project.id, path: moved })).toMatchObject({ path: moved, available: true })
  })
})

describe('turnos', () => {
  it('flujo completo: aprobación, edición, cambios, diff y revertir', async () => {
    const h = await boot([EDIT, say('Listo')])
    const { session } = await h.openSession()
    expect(await h.call('turn.send', { sessionId: session.id, text: 'arregla el flag' })).toEqual({})
    const { approval } = await h.waitFor('approval.requested')
    expect(readFileSync(join(h.root, 'src/auth.ts'), 'utf8')).toContain('false')

    const during = await h.call('sessions.get', { id: session.id })
    expect(during.pendingApprovals).toEqual([approval])
    expect(during.session.turnStatus).toBe('running')

    await h.call('approval.resolve', { approvalId: approval.id, decision: 'once' })
    expect((await h.idle(session.id)).status).toBe('idle')
    expect(readFileSync(join(h.root, 'src/auth.ts'), 'utf8')).toContain('true')

    const after = await h.call('sessions.get', { id: session.id })
    expect(after.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(after.pendingApprovals).toEqual([])
    expect(after.usedTokens).toBe(110)
    expect(after.windowTokens).toBe(32_768)
    expect(after.session.title).toBe('arregla el flag')

    expect(await h.call('changes.list', { sessionId: session.id })).toEqual([{ path: 'src/auth.ts', status: 'modified' }])
    expect(await h.call('changes.diff', { sessionId: session.id, path: 'src/auth.ts' })).toEqual({
      original: 'export const ok = false\n',
      current: 'export const ok = true\n',
    })
    await h.call('changes.revert', { sessionId: session.id, path: 'src/auth.ts' })
    expect(readFileSync(join(h.root, 'src/auth.ts'), 'utf8')).toContain('false')
    expect(await h.call('changes.list', { sessionId: session.id })).toEqual([])
    expect(await code(h.call('changes.diff', { sessionId: session.id, path: '../x' }))).toBe('outside_root')
  })

  it('"always" queda guardado como regla listable y borrable', async () => {
    const h = await boot([EDIT, say('ok')])
    const { session, project } = await h.openSession()
    await h.call('turn.send', { sessionId: session.id, text: 'x' })
    await h.call('approval.resolve', { approvalId: (await h.waitFor('approval.requested')).approval.id, decision: 'always' })
    await h.idle(session.id)
    const rules = await h.call('permissions.list', { projectId: project.id })
    expect(rules).toMatchObject([{ toolName: 'edit_file', pattern: '*' }])
    await h.call('permissions.remove', { id: rules[0]!.id })
    expect(await h.call('permissions.list', { projectId: project.id })).toEqual([])
  })

  it('turn.stop interrumpe; turn.send con un turno en curso se rechaza', async () => {
    const h = await boot([EDIT, say('nunca')])
    const { session } = await h.openSession()
    await h.call('turn.send', { sessionId: session.id, text: 'x' })
    await h.waitFor('approval.requested')
    expect(await code(h.call('turn.send', { sessionId: session.id, text: 'otro' }))).toBe('invalid_params')
    await h.call('turn.stop', { sessionId: session.id })
    expect((await h.idle(session.id)).status).toBe('interrupted')
  })

  it('dos sesiones ejecutan turnos a la vez sin mezclar eventos', async () => {
    const h = await boot([EDIT, say('Listo')])
    const { session: a, project, fakeId } = await h.openSession()
    const b = await h.call('sessions.create', { projectId: project.id, providerId: fakeId, model: 'fake-model' })
    await h.call('turn.send', { sessionId: a.id, text: 'uno' })
    await h.call('turn.send', { sessionId: b.id, text: 'dos' })
    const approvals = [
      await h.waitFor('approval.requested', (e) => e.sessionId === a.id),
      await h.waitFor('approval.requested', (e) => e.sessionId === b.id),
    ]
    expect(new Set(approvals.map((e) => e.approval.id)).size).toBe(2)
    await h.call('approval.resolve', { approvalId: approvals[1]!.approval.id, decision: 'deny' })
    expect((await h.idle(b.id)).status).toBe('idle')
    expect((await h.call('sessions.get', { id: a.id })).session.turnStatus).toBe('running')
    await h.call('turn.stop', { sessionId: a.id })
    await h.idle(a.id)
    expect((await h.call('sessions.list', { projectId: project.id })).map((s) => s.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('borrar una sesión no espera a los turnos de las demás', async () => {
    const h = await boot([EDIT])
    const { session: a, project, fakeId } = await h.openSession()
    const b = await h.call('sessions.create', { projectId: project.id, providerId: fakeId, model: 'fake-model' })
    await h.call('turn.send', { sessionId: a.id, text: 'uno' })
    await h.call('turn.send', { sessionId: b.id, text: 'dos' })
    await h.waitFor('approval.requested', (e) => e.sessionId === a.id)
    await h.waitFor('approval.requested', (e) => e.sessionId === b.id)
    const deleted = await Promise.race([
      h.call('sessions.delete', { id: a.id }).then(() => 'borrada'),
      new Promise((r) => setTimeout(() => r('colgada'), 2000)),
    ])
    expect(deleted).toBe('borrada')
    expect((await h.call('sessions.get', { id: b.id })).pendingApprovals).toHaveLength(1)
  })

  it('borrar una sesión con un turno en curso lo detiene', async () => {
    const h = await boot([EDIT])
    const { session, project } = await h.openSession()
    await h.call('turn.send', { sessionId: session.id, text: 'x' })
    await h.waitFor('approval.requested')
    await h.call('sessions.delete', { id: session.id })
    expect(await h.call('sessions.list', { projectId: project.id })).toEqual([])
    expect(readFileSync(join(h.root, 'src/auth.ts'), 'utf8')).toContain('false')
  })
})

describe('archivos', () => {
  it('fs.list pone carpetas primero, oculta .git y usa rutas relativas con /', async () => {
    const h = await boot()
    mkdirSync(join(h.root, '.git'))
    writeFileSync(join(h.root, 'b.txt'), '')
    writeFileSync(join(h.root, 'A.txt'), '')
    const project = await h.call('projects.add', { path: h.root })
    expect(await h.call('fs.list', { projectId: project.id, dir: '' })).toEqual([
      { name: 'src', path: 'src', isDir: true },
      { name: 'A.txt', path: 'A.txt', isDir: false },
      { name: 'b.txt', path: 'b.txt', isDir: false },
    ])
    expect(await h.call('fs.list', { projectId: project.id, dir: 'src' })).toEqual([{ name: 'auth.ts', path: 'src/auth.ts', isDir: false }])
  })

  it('fs.read y fs.write respetan la jaula y los límites', async () => {
    const h = await boot()
    writeFileSync(join(h.root, 'grande.txt'), 'x'.repeat(3 * 1024 * 1024))
    writeFileSync(join(h.root, 'img.bin'), Buffer.from([1, 0, 2]))
    const project = await h.call('projects.add', { path: h.root })
    const at = (path: string) => ({ projectId: project.id, path })
    expect(await h.call('fs.read', at('src/auth.ts'))).toEqual({ content: 'export const ok = false\n' })
    expect(await code(h.call('fs.read', at('../fuera.txt')))).toBe('outside_root')
    expect(await code(h.call('fs.read', at('grande.txt')))).toBe('too_large')
    expect(await code(h.call('fs.read', at('img.bin')))).toBe('binary')
    expect(await code(h.call('fs.read', at('nada.txt')))).toBe('not_found')
    await h.call('fs.write', { ...at('nueva/x.ts'), content: 'hola' })
    expect(readFileSync(join(h.root, 'nueva/x.ts'), 'utf8')).toBe('hola')
    expect(await code(h.call('fs.write', { ...at('../fuera.txt'), content: 'x' }))).toBe('outside_root')
    expect(existsSync(join(h.work, 'fuera.txt'))).toBe(false)
  })

  it('un archivo nuevo emite tree.changed de su carpeta; node_modules y .git no emiten', async () => {
    const h = await boot()
    mkdirSync(join(h.root, 'node_modules/dep'), { recursive: true })
    mkdirSync(join(h.root, '.git'))
    const project = await h.call('projects.add', { path: h.root })
    await h.call('fs.list', { projectId: project.id, dir: '' })
    await new Promise((r) => setTimeout(r, 300))
    for (let i = 0; i < 100; i++) writeFileSync(join(h.root, 'node_modules/dep', `f${i}.js`), '')
    writeFileSync(join(h.root, '.git/HEAD'), 'x')
    writeFileSync(join(h.root, 'src/nuevo.ts'), '')
    const event = await h.waitFor('tree.changed', (e) => e.dir === 'src')
    expect(event).toEqual({ type: 'tree.changed', projectId: project.id, dir: 'src' })
    await new Promise((r) => setTimeout(r, 600))
    const dirs = h.events.flatMap((e) => (e.type === 'tree.changed' ? [e.dir] : []))
    expect(dirs.some((d) => d.includes('node_modules') || d.includes('.git'))).toBe(false)
  })

  it('una ráfaga de 100 archivos en la misma carpeta se agrupa en pocos eventos', async () => {
    const h = await boot()
    const project = await h.call('projects.add', { path: h.root })
    await h.call('fs.list', { projectId: project.id, dir: '' })
    await new Promise((r) => setTimeout(r, 300))
    for (let i = 0; i < 100; i++) writeFileSync(join(h.root, 'src', `f${i}.ts`), '')
    await h.waitFor('tree.changed', (e) => e.dir === 'src')
    await new Promise((r) => setTimeout(r, 800))
    expect(h.events.filter((e) => e.type === 'tree.changed' && e.dir === 'src').length).toBeLessThanOrEqual(3)
  })
})

describe('proveedores y ajustes', () => {
  it('la clave se descifra al usar el proveedor y nunca se devuelve', async () => {
    const decrypted: string[] = []
    const h = await boot([], { decrypt: async (c) => (decrypted.push(c), 'sk-real') })
    const project = await h.call('projects.add', { path: h.root })
    const saved = await h.call('providers.save', { type: 'openai-compatible', name: 'Remoto', baseUrl: 'http://127.0.0.1:1/v1', keyCipher: 'CIFRADO', contextSize: 64000 })
    expect(saved).toMatchObject({ hasKey: true, contextSize: 64000 })
    expect(JSON.stringify(await h.call('providers.list', {}))).not.toContain('CIFRADO')
    const session = await h.call('sessions.create', { projectId: project.id, providerId: saved.id, model: 'm' })
    await h.call('turn.send', { sessionId: session.id, text: 'hola' })
    const end = await h.idle(session.id)
    expect(end).toMatchObject({ status: 'failed', error: expect.stringContaining('No se pudo conectar') })
    expect(decrypted).toEqual(['CIFRADO'])

    const kept = await h.call('providers.save', { id: saved.id, type: 'openai-compatible', name: 'Renombrado', baseUrl: 'http://127.0.0.1:1/v1', contextSize: null })
    expect(kept).toMatchObject({ name: 'Renombrado', hasKey: true })
    const cleared = await h.call('providers.save', { id: saved.id, type: 'openai-compatible', name: 'Renombrado', baseUrl: 'http://127.0.0.1:1/v1', keyCipher: null, contextSize: null })
    expect(cleared.hasKey).toBe(false)
    await h.call('providers.remove', { id: saved.id })
    expect((await h.call('providers.list', {})).some((p) => p.config.id === saved.id)).toBe(false)
  })

  it('modelos y capacidades del proveedor; proveedor inaccesible → provider_unreachable', async () => {
    const h = await boot()
    const list = await h.call('providers.list', {})
    const fake = list.find((p) => p.config.type === 'fake')!.config.id
    expect(await h.call('providers.models', { providerId: fake })).toEqual(['fake-model'])
    expect(await h.call('providers.capabilities', { providerId: fake, model: 'fake-model' })).toEqual({ tools: 'yes', contextWindow: 32_768 })
    const dead = await h.call('providers.save', { type: 'openai-compatible', name: 'x', baseUrl: 'http://127.0.0.1:1/v1', contextSize: null })
    expect(await code(h.call('providers.models', { providerId: dead.id }))).toBe('provider_unreachable')
    expect((await h.call('providers.list', {})).find((p) => p.config.id === dead.id)!.reachable).toBe(false)
  })

  it('settings guarda y devuelve el modelo por defecto', async () => {
    const h = await boot()
    expect(await h.call('settings.get', {})).toEqual({ defaultProviderId: null, defaultModel: null })
    await h.call('settings.set', { defaultProviderId: 'p', defaultModel: 'm' })
    expect(await h.call('settings.get', {})).toEqual({ defaultProviderId: 'p', defaultModel: 'm' })
  })
})
