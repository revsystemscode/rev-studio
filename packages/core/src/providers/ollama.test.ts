import { describe, expect, it } from 'vitest'
import type { ProviderRow } from '../db/repos/providers'
import { createProvider } from './registry'
import { collect, fakeFetch, json, ndjson } from './testing'
import { ProviderHttpError, ProviderUnreachableError, type ChatMessage } from './types'

const row: ProviderRow = { id: 'o', type: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434', keyCipher: null, contextSize: null }
const show = (capabilities: string[], ctx = 262144) => () =>
  json({ capabilities, model_info: { 'general.architecture': 'qwen35', 'qwen35.context_length': ctx } })
const signal = () => new AbortController().signal
const user = (text: string): ChatMessage => ({ role: 'user', parts: [{ type: 'text', text }] })
const done = { done: true, prompt_eval_count: 120, eval_count: 30, message: { role: 'assistant', content: '' } }

describe('ollama', () => {
  it('listModels devuelve los nombres de /api/tags', async () => {
    const f = fakeFetch({ '/api/tags': () => json({ models: [{ name: 'qwen3:14b' }, { name: 'gemma4' }] }) })
    expect(await createProvider(row, null, f.impl).listModels()).toEqual(['qwen3:14b', 'gemma4'])
  })

  it('capabilities: tools yes y la ventana efectiva (la que se pedirá como num_ctx)', async () => {
    const f = fakeFetch({ '/api/show': show(['completion', 'tools']) })
    expect(await createProvider(row, null, f.impl).getCapabilities('m')).toEqual({ tools: 'yes', contextWindow: 32768 })
    expect(f.calls[0]!.body).toEqual({ model: 'm' })
    const small = fakeFetch({ '/api/show': show(['tools'], 8192) })
    expect((await createProvider(row, null, small.impl).getCapabilities('m')).contextWindow).toBe(8192)
    const big = fakeFetch({ '/api/show': show(['tools']) })
    expect((await createProvider({ ...row, contextSize: 65536 }, null, big.impl).getCapabilities('m')).contextWindow).toBe(65536)
  })

  it('capabilities: tools no cuando falta "tools"', async () => {
    const f = fakeFetch({ '/api/show': show(['completion']) })
    expect((await createProvider(row, null, f.impl).getCapabilities('m')).tools).toBe('no')
  })

  it('streamStep convierte NDJSON en text, tool-call y finish con tokens', async () => {
    const f = fakeFetch({
      '/api/show': show(['tools']),
      '/api/chat': () =>
        new Response(
          ndjson([
            { message: { role: 'assistant', content: 'Voy a ', thinking: 'pensando' } },
            { message: { role: 'assistant', content: 'leer.' } },
            { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }] } },
            done,
          ]),
        ),
    })
    const events = await collect(
      createProvider(row, null, f.impl).createModel('m').streamStep({ messages: [user('hola')], tools: [], signal: signal() }),
    )
    expect(events).toEqual([
      { type: 'text', delta: 'Voy a ' },
      { type: 'text', delta: 'leer.' },
      { type: 'tool-call', callId: expect.any(String), name: 'read_file', input: { path: 'a.ts' } },
      { type: 'finish', inputTokens: 120, outputTokens: 30 },
    ])
  })

  it('envía num_ctx 32768 por defecto, el del modelo si es menor, y el configurado si existe', async () => {
    const run = async (r: ProviderRow, ctx: number) => {
      const f = fakeFetch({ '/api/show': show(['tools'], ctx), '/api/chat': () => new Response(ndjson([done])) })
      await collect(createProvider(r, null, f.impl).createModel('m').streamStep({ messages: [user('x')], tools: [], signal: signal() }))
      return f.calls.find((c) => c.url.endsWith('/api/chat'))!.body
    }
    expect((await run(row, 262144)).options.num_ctx).toBe(32768)
    expect((await run(row, 8192)).options.num_ctx).toBe(8192)
    expect((await run({ ...row, contextSize: 65536 }, 262144)).options.num_ctx).toBe(65536)
    expect(await run(row, 262144)).toMatchObject({ model: 'm', stream: true })
  })

  it('envía herramientas, llamadas previas y resultados con tool_name', async () => {
    const f = fakeFetch({ '/api/show': show(['tools']), '/api/chat': () => new Response(ndjson([done])) })
    const messages: ChatMessage[] = [
      { role: 'system', parts: [{ type: 'text', text: 'sys' }] },
      user('lee a.ts'),
      { role: 'assistant', parts: [{ type: 'text', text: 'ok' }, { type: 'tool-call', callId: 'c1', name: 'read_file', input: { path: 'a.ts' } }] },
      { role: 'tool', parts: [{ type: 'tool-result', callId: 'c1', output: 'contenido', isError: false }] },
    ]
    const tools = [{ name: 'read_file', description: 'd', parameters: { type: 'object' } }]
    await collect(createProvider(row, null, f.impl).createModel('m').streamStep({ messages, tools, signal: signal() }))
    const body = f.calls.find((c) => c.url.endsWith('/api/chat'))!.body
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'lee a.ts' },
      { role: 'assistant', content: 'ok', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.ts' } } }] },
      { role: 'tool', content: 'contenido', tool_name: 'read_file' },
    ])
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'read_file', description: 'd', parameters: { type: 'object' } } }])
  })

  it('fetch rechazado → ProviderUnreachableError', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const p = createProvider(row, null, impl)
    await expect(p.listModels()).rejects.toBeInstanceOf(ProviderUnreachableError)
    expect(await p.ping()).toBe(false)
  })

  it('un error HTTP o un error dentro del stream se propagan con su mensaje', async () => {
    const f = fakeFetch({ '/api/show': show(['tools']), '/api/chat': () => json({ error: 'model does not support tools' }, 400) })
    const step = () => collect(createProvider(row, null, f.impl).createModel('m').streamStep({ messages: [user('x')], tools: [], signal: signal() }))
    await expect(step()).rejects.toThrow(/does not support tools/)
    await expect(step()).rejects.toBeInstanceOf(ProviderHttpError)
    const g = fakeFetch({ '/api/show': show(['tools']), '/api/chat': () => new Response(ndjson([{ error: 'se cayó' }])) })
    await expect(
      collect(createProvider(row, null, g.impl).createModel('m').streamStep({ messages: [user('x')], tools: [], signal: signal() })),
    ).rejects.toThrow(/se cayó/)
  })

  it('con la señal abortada el iterador termina sin eventos', async () => {
    const f = fakeFetch({ '/api/show': show(['tools']), '/api/chat': () => new Response(ndjson([done])) })
    const abort = new AbortController()
    abort.abort()
    expect(await collect(createProvider(row, null, f.impl).createModel('m').streamStep({ messages: [user('x')], tools: [], signal: abort.signal }))).toEqual([])
  })
})
