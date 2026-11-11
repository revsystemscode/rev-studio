import { afterEach, describe, expect, it } from 'vitest'
import { messagesRepo } from '../db/repos/messages'
import { FakeModelClient } from '../providers/fake'
import { ProviderUnreachableError, type ModelClient } from '../providers/types'
import { cleanupProjects, makeProject } from '../testing/project'
import { compact, shouldCompact } from './compaction'
import { buildModelMessages } from './history'
import { call, harness, say } from './testing'

afterEach(cleanupProjects)

function conversation(turns: number) {
  const p = makeProject()
  const messages = messagesRepo(p.db)
  for (let t = 1; t <= turns; t++) {
    messages.append(p.sessionId, 'user', [{ type: 'text', text: `pregunta ${t}` }])
    messages.append(p.sessionId, 'assistant', [{ type: 'text', text: `respuesta ${t}` }])
  }
  const run = (model: ModelClient) =>
    compact({ sessionId: p.sessionId, root: p.root, model, messages, signal: new AbortController().signal })
  return { p, messages, run }
}
const summarizer = (text: string) => new FakeModelClient([say(text)])
const sent = (m: FakeModelClient, i = 0) => JSON.stringify(m.requests[i])

describe('shouldCompact', () => {
  it('se activa por encima del 80 % de la ventana y nunca sin ventana conocida', () => {
    expect(shouldCompact(8100, 10_000)).toBe(true)
    expect(shouldCompact(7900, 10_000)).toBe(false)
    expect(shouldCompact(999_999, null)).toBe(false)
  })
})

describe('compact', () => {
  it('con 5 turnos guarda un resumen que cubre hasta justo antes del turno 4', async () => {
    const { p, messages, run } = conversation(5)
    const model = summarizer('RESUMEN-1')
    expect(await run(model)).toBe(true)
    const summary = messages.list(p.sessionId).at(-1)!
    expect(summary).toMatchObject({ role: 'summary', coversUpToSeq: 6, parts: [{ type: 'text', text: 'RESUMEN-1' }] })
    expect(sent(model)).toContain('pregunta 3')
    expect(sent(model)).not.toContain('pregunta 4')
    expect(model.toolRequests[0]).toEqual([])
  })

  it('tras compactar, el modelo recibe el resumen y los dos últimos turnos íntegros', async () => {
    const { p, messages, run } = conversation(5)
    await run(summarizer('RESUMEN-1'))
    const built = buildModelMessages(messages.list(p.sessionId), p.root)
    expect(built.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant', 'user', 'assistant'])
    const text = JSON.stringify(built)
    expect(text).toContain('RESUMEN-1')
    expect(text).toContain('pregunta 4')
    expect(text).toContain('respuesta 5')
    expect(text).not.toContain('pregunta 3')
  })

  it('los mensajes originales siguen guardados', async () => {
    const { p, messages, run } = conversation(5)
    await run(summarizer('R'))
    expect(messages.list(p.sessionId).filter((m) => m.role !== 'summary')).toHaveLength(10)
  })

  it('con 2 turnos no hay nada que compactar', async () => {
    const { p, messages, run } = conversation(2)
    const model = summarizer('R')
    expect(await run(model)).toBe(false)
    expect(model.requests).toHaveLength(0)
    expect(messages.list(p.sessionId)).toHaveLength(4)
  })

  it('una segunda compactación incluye el resumen previo y avanza la cobertura', async () => {
    const { p, messages, run } = conversation(5)
    await run(summarizer('RESUMEN-1'))
    for (const t of [6, 7]) {
      messages.append(p.sessionId, 'user', [{ type: 'text', text: `pregunta ${t}` }])
      messages.append(p.sessionId, 'assistant', [{ type: 'text', text: `respuesta ${t}` }])
    }
    const model = summarizer('RESUMEN-2')
    expect(await run(model)).toBe(true)
    expect(sent(model)).toContain('RESUMEN-1')
    expect(sent(model)).toContain('pregunta 5')
    expect(sent(model)).not.toContain('pregunta 3')
    expect(sent(model)).not.toContain('pregunta 6')
    const built = JSON.stringify(buildModelMessages(messages.list(p.sessionId), p.root))
    expect(built).toContain('RESUMEN-2')
    expect(built).not.toContain('RESUMEN-1')
    expect(built).toContain('pregunta 6')
    expect(built).not.toContain('pregunta 5')
  })

  it('si el modelo falla o no devuelve texto, no guarda nada', async () => {
    const { p, messages, run } = conversation(5)
    const failing: ModelClient = {
      // eslint-disable-next-line require-yield
      async *streamStep() {
        throw new ProviderUnreachableError('caído')
      },
    }
    expect(await run(failing)).toBe(false)
    expect(await run(new FakeModelClient([[{ type: 'finish', inputTokens: 1, outputTokens: 0 }]]))).toBe(false)
    expect(messages.list(p.sessionId)).toHaveLength(10)
  })

  it('no parte un turno: las llamadas a herramientas quedan con su turno', async () => {
    const h = harness([call('list_dir', { path: '.' }), say('a'), say('b'), say('c'), say('d')])
    for (const q of ['uno', 'dos', 'tres', 'cuatro']) await h.runner.send(q)
    const model = summarizer('R')
    await compact({ sessionId: h.p.sessionId, root: h.p.root, model, messages: h.messages, signal: new AbortController().signal })
    const summary = h.messages.list(h.p.sessionId).at(-1)!
    const firstKept = h.messages.list(h.p.sessionId).find((m) => m.seq === summary.coversUpToSeq! + 1)!
    expect(firstKept).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'tres' }] })
  })
})

describe('compactación dentro del bucle', () => {
  it('beforeStep se ejecuta antes de cada llamada al modelo', async () => {
    let calls = 0
    const h = harness([call('list_dir', { path: '.' }), say('fin')], {}, { beforeStep: async () => void calls++ })
    await h.runner.send('x')
    expect(calls).toBe(2)
  })
})
