import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { permissionsRepo } from '../db/repos/permissions'
import { ProviderUnreachableError, type ModelClient, type StepEvent } from '../providers/types'
import { cleanupProjects } from '../testing/project'
import { editFile } from '../tools/edit-file'
import { buildModelMessages } from './history'
import { MAX_STEPS } from './runner'
import { call, finish, harness, say } from './testing'

afterEach(cleanupProjects)

const file = { 'src/auth.ts': 'export const ok = false\n' }
const editInput = { path: 'src/auth.ts', oldText: 'false', newText: 'true' }
const disk = (h: ReturnType<typeof harness>) => readFileSync(join(h.p.root, 'src/auth.ts'), 'utf8')
const lastToolResult = (h: ReturnType<typeof harness>) => {
  const part = h.model.requests.at(-1)!.at(-1)!.parts.at(-1)!
  if (part.type !== 'tool-result') throw new Error('el último mensaje no es un resultado de herramienta')
  return part
}

describe('SessionRunner', () => {
  it('respuesta de solo texto: guarda user y assistant, emite deltas y termina en idle', async () => {
    const h = harness([[{ type: 'text', delta: 'Ho' }, { type: 'text', delta: 'la' }, finish]])
    await h.runner.send('hola')
    expect(h.messages.list(h.p.sessionId).map((m) => [m.role, m.parts])).toEqual([
      ['user', [{ type: 'text', text: 'hola' }]],
      ['assistant', [{ type: 'text', text: 'Hola' }]],
    ])
    expect(h.events.flatMap((e) => (e.type === 'text.delta' ? [e.delta] : []))).toEqual(['Ho', 'la'])
    expect(h.statuses()).toEqual(['running', 'idle'])
    expect(h.sessions.get(h.p.sessionId)!.turnStatus).toBe('idle')
    expect(h.runner.running).toBe(false)
  })

  it('el modelo recibe el prompt de sistema con la raíz y las siete herramientas', async () => {
    const h = harness([say('ok')])
    await h.runner.send('hola')
    expect(h.model.requests[0]![0]).toMatchObject({ role: 'system' })
    expect(h.model.requests[0]![0]!.parts[0]).toMatchObject({ text: expect.stringContaining(h.p.root) })
    expect(h.model.toolRequests[0]).toHaveLength(7)
  })

  it('una herramienta de lectura se ejecuta sin aprobación y su resultado vuelve al modelo', async () => {
    const h = harness([call('read_file', { path: 'src/auth.ts' }, 'r1'), say('listo')], file)
    await h.runner.send('lee')
    expect(h.events.some((e) => e.type === 'approval.requested')).toBe(false)
    expect(lastToolResult(h)).toMatchObject({ callId: 'r1', isError: false, output: expect.stringContaining('export const ok = false') })
    expect(h.events.filter((e) => e.type === 'tool.started' || e.type === 'tool.finished').map((e) => e.type)).toEqual([
      'tool.started',
      'tool.finished',
    ])
    expect(h.messages.list(h.p.sessionId).map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('edit_file pide aprobación con el diff y espera; "once" aplica la edición', async () => {
    const h = harness([call('edit_file', editInput, 'e1'), say('hecho')], file)
    const turn = h.runner.send('arregla')
    const { approval } = await h.waitFor('approval.requested')
    expect(approval).toMatchObject({
      sessionId: h.p.sessionId,
      callId: 'e1',
      toolName: 'edit_file',
      preview: { kind: 'diff', path: 'src/auth.ts', original: 'export const ok = false\n', proposed: 'export const ok = true\n' },
    })
    expect(disk(h)).toContain('false')
    expect(h.runner.pendingApprovals()).toEqual([approval])
    h.runner.resolveApproval(approval.id, 'once')
    await turn
    expect(disk(h)).toContain('true')
    expect(h.runner.pendingApprovals()).toEqual([])
    expect(h.events.some((e) => e.type === 'approval.resolved' && e.approvalId === approval.id)).toBe(true)
    expect(h.events.some((e) => e.type === 'file.changed' && e.path === 'src/auth.ts')).toBe(true)
    expect(h.permissions.check(h.p.projectId, editFile, editInput)).toBe('ask')
  })

  it('"deny" no toca el archivo y el modelo recibe el rechazo', async () => {
    const h = harness([call('edit_file', editInput), say('vale')], file)
    const turn = h.runner.send('arregla')
    h.runner.resolveApproval((await h.waitFor('approval.requested')).approval.id, 'deny')
    await turn
    expect(disk(h)).toContain('false')
    expect(lastToolResult(h)).toMatchObject({ isError: true, output: 'El usuario rechazó esta acción.' })
    expect(h.statuses().at(-1)).toBe('idle')
  })

  it('"always" guarda la regla y la siguiente edición no pide aprobación', async () => {
    const h = harness(
      [call('edit_file', editInput), call('edit_file', { path: 'src/auth.ts', oldText: 'true', newText: 'null' }), say('hecho')],
      file,
    )
    const turn = h.runner.send('arregla')
    h.runner.resolveApproval((await h.waitFor('approval.requested')).approval.id, 'always')
    await turn
    expect(disk(h)).toContain('null')
    expect(h.events.filter((e) => e.type === 'approval.requested')).toHaveLength(1)
  })

  it('un ToolError se devuelve al modelo y el turno continúa', async () => {
    const h = harness([call('read_file', { path: 'no-existe.ts' }), say('no está')])
    await h.runner.send('lee')
    expect(lastToolResult(h)).toMatchObject({ isError: true, output: expect.stringContaining('No existe') })
    expect(h.statuses().at(-1)).toBe('idle')
  })

  it('una edición imposible falla en la vista previa sin pedir aprobación', async () => {
    const h = harness([call('edit_file', { ...editInput, oldText: 'inexistente' }), say('vaya')], file)
    await h.runner.send('arregla')
    expect(h.events.some((e) => e.type === 'approval.requested')).toBe(false)
    expect(lastToolResult(h)).toMatchObject({ isError: true, output: expect.stringContaining('no aparece') })
  })

  it('herramienta desconocida y argumentos inválidos → resultado de error con el motivo', async () => {
    const h = harness([
      [{ type: 'tool-call', callId: 'a', name: 'volar', input: {} }, { type: 'tool-call', callId: 'b', name: 'read_file', input: '{"path": mal' }, finish],
      say('perdón'),
    ])
    await h.runner.send('x')
    const results = h.model.requests.at(-1)!.at(-1)!.parts
    expect(results[0]).toMatchObject({ callId: 'a', isError: true, output: expect.stringContaining('volar') })
    expect(results[1]).toMatchObject({ callId: 'b', isError: true, output: expect.stringContaining('read_file') })
    expect(h.statuses().at(-1)).toBe('idle')
  })

  it('tres pasos seguidos con llamadas mal formadas detienen el turno con la sugerencia', async () => {
    const bad = () => call('read_file', { ruta: 'x' })
    const h = harness([bad(), bad(), bad(), say('nunca')])
    await h.runner.send('x')
    expect(h.model.requests).toHaveLength(3)
    expect(h.events.at(-1)).toEqual({
      type: 'turn.status',
      sessionId: h.p.sessionId,
      status: 'failed',
      error: 'El modelo no consigue llamar a las herramientas correctamente. Prueba con otro modelo.',
    })
    expect(h.sessions.get(h.p.sessionId)).toMatchObject({ turnStatus: 'failed', turnError: expect.stringContaining('otro modelo') })
  })

  it('un paso válido entre medias reinicia la cuenta de mal formadas', async () => {
    const bad = () => call('read_file', { ruta: 'x' })
    const good = () => call('list_dir', { path: '.' })
    const h = harness([bad(), bad(), good(), bad(), bad(), say('fin')])
    await h.runner.send('x')
    expect(h.statuses().at(-1)).toBe('idle')
    expect(h.model.requests).toHaveLength(6)
  })

  it(`con herramientas sin fin hace exactamente ${MAX_STEPS} llamadas al modelo y avisa del límite`, async () => {
    const h = harness(Array.from({ length: 60 }, () => call('list_dir', { path: '.' })))
    await h.runner.send('x')
    expect(h.model.requests).toHaveLength(50)
    expect(h.statuses().at(-1)).toBe('idle')
    expect(h.messages.list(h.p.sessionId).at(-1)).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Se alcanzó el límite de 50 pasos. Escribe para continuar.' }],
    })
  })

  it('stop durante una aprobación pendiente deja el turno interrumpido', async () => {
    const h = harness([call('edit_file', editInput), say('nunca')], file)
    const turn = h.runner.send('arregla')
    await h.waitFor('approval.requested')
    h.runner.stop()
    await turn
    expect(h.statuses().at(-1)).toBe('interrupted')
    expect(h.runner.pendingApprovals()).toEqual([])
    expect(disk(h)).toContain('false')
    expect(h.model.requests).toHaveLength(1)
  })

  it('stop durante run_command mata el proceso', async () => {
    const h = harness([call('run_command', { command: 'node s.js' }), say('nunca')], { 's.js': 'setTimeout(() => {}, 60000)' })
    permissionsRepo(h.p.db).add(h.p.projectId, 'run_command', 'node s.js')
    const started = Date.now()
    const turn = h.runner.send('ejecuta')
    await h.waitFor('tool.started')
    await new Promise((r) => setTimeout(r, 300))
    h.runner.stop()
    await turn
    expect(Date.now() - started).toBeLessThan(8000)
    expect(h.statuses().at(-1)).toBe('interrupted')
  })

  it('stop a mitad de la respuesta conserva el texto generado', async () => {
    const h = harness([[{ type: 'text', delta: 'Empiezo ' }, { type: 'text', delta: 'y sigo' }, finish]], {}, { delayMs: 150 })
    const turn = h.runner.send('x')
    await h.waitFor('text.delta')
    h.runner.stop()
    await turn
    expect(h.statuses().at(-1)).toBe('interrupted')
    expect(h.messages.list(h.p.sessionId).at(-1)).toMatchObject({ role: 'assistant', parts: [{ type: 'text', text: 'Empiezo ' }] })
  })

  it('recorta la salida de run_command pero no la de read_file', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `linea ${i + 1}`).join('\n')
    const h = harness([call('run_command', { command: 'node s.js' }), call('read_file', { path: 'big.txt' }), say('fin')], {
      's.js': "for (let i = 1; i <= 1000; i++) console.log('linea ' + i)",
      'big.txt': lines,
    })
    // remember no guarda reglas para node (ejecuta cualquier código): la regla se crea a mano.
    permissionsRepo(h.p.db).add(h.p.projectId, 'run_command', 'node s.js')
    await h.runner.send('x')
    const [, , commandResult, , readResult] = h.model.requests.at(-1)!.slice(1)
    expect(commandResult!.parts[0]).toMatchObject({ output: expect.stringContaining('líneas omitidas') })
    expect(readResult!.parts[0]).toMatchObject({ output: expect.not.stringContaining('omitidas') })
    expect((readResult!.parts[0] as { output: string }).output).toContain('linea 500')
  })

  it('un proveedor caído deja el turno en failed y retry lo completa', async () => {
    let calls = 0
    const flaky: ModelClient = {
      async *streamStep(): AsyncGenerator<StepEvent> {
        if (++calls === 1) throw new ProviderUnreachableError('No se pudo conectar con localhost:11434.')
        yield* say('ya estoy')
      },
    }
    const h = harness([], {}, { model: flaky })
    await h.runner.send('hola')
    expect(h.events.at(-1)).toMatchObject({ type: 'turn.status', status: 'failed', error: 'No se pudo conectar con localhost:11434.' })
    await h.runner.retry()
    expect(h.statuses().at(-1)).toBe('idle')
    expect(h.messages.list(h.p.sessionId).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('el primer mensaje fija el título de la sesión, recortado a 60 caracteres', async () => {
    const h = harness([say('a'), say('b')])
    await h.runner.send(`  Arregla el\nlogin ${'x'.repeat(80)}`)
    const title = h.sessions.get(h.p.sessionId)!.title
    expect(title).toHaveLength(60)
    expect(title.startsWith('Arregla el login xxx')).toBe(true)
    await h.runner.send('otra cosa')
    expect(h.sessions.get(h.p.sessionId)!.title).toBe(title)
  })

  it('send y retry con un turno en curso lanzan', async () => {
    const h = harness([call('edit_file', editInput), say('fin')], file)
    const turn = h.runner.send('x')
    await h.waitFor('approval.requested')
    expect(h.runner.running).toBe(true)
    expect(() => h.runner.send('otro')).toThrow()
    expect(() => h.runner.retry()).toThrow()
    h.runner.stop()
    await turn
  })

  it('emite el uso de contexto del paso; sin tokens, lo estima', async () => {
    const h = harness([say('hola'), [{ type: 'text', delta: 'x'.repeat(400) }, { type: 'finish', inputTokens: null, outputTokens: null }]])
    await h.runner.send('a')
    expect(h.events.find((e) => e.type === 'context.usage')).toEqual({
      type: 'context.usage',
      sessionId: h.p.sessionId,
      usedTokens: 110,
      windowTokens: 32_768,
    })
    expect(h.runner.usedTokens).toBe(110)
    await h.runner.send('b')
    expect(h.runner.usedTokens).toBeGreaterThan(100)
  })
})

describe('buildModelMessages', () => {
  it('completa con "Interrumpido." las llamadas que quedaron sin resultado', async () => {
    const h = harness([call('edit_file', editInput, 'huerfana'), say('nunca')], file)
    const turn = h.runner.send('arregla')
    await h.waitFor('approval.requested')
    h.runner.stop()
    await turn
    const stored = h.messages.list(h.p.sessionId)
    const built = buildModelMessages(stored, h.p.root)
    const calls = built.flatMap((m) => m.parts).filter((p) => p.type === 'tool-call')
    const results = built.flatMap((m) => m.parts).filter((p) => p.type === 'tool-result')
    expect(calls).toHaveLength(1)
    expect(results).toEqual([{ type: 'tool-result', callId: 'huerfana', output: 'Interrumpido.', isError: true }])
  })

  it('con un resumen, solo envía el resumen y los mensajes posteriores a lo que cubre', () => {
    const msg = (seq: number, role: 'user' | 'assistant' | 'summary', text: string, coversUpToSeq: number | null = null) => ({
      id: String(seq), sessionId: 's', seq, role, parts: [{ type: 'text' as const, text }], coversUpToSeq, createdAt: 0,
    })
    const built = buildModelMessages(
      [msg(1, 'user', 'viejo'), msg(2, 'assistant', 'vieja respuesta'), msg(3, 'user', 'reciente'), msg(4, 'summary', 'RESUMEN', 2), msg(5, 'assistant', 'nueva')],
      '/raiz',
    )
    expect(built.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant'])
    expect(built[1]!.parts[0]).toMatchObject({ text: expect.stringContaining('RESUMEN') })
    expect(JSON.stringify(built)).not.toContain('viejo')
  })
})
