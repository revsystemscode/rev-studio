import { describe, expect, it } from 'vitest'
import type { ProviderRow } from '../db/repos/providers'
import { createProvider } from './registry'
import { collect, fakeFetch, json, sse } from './testing'
import type { ChatMessage } from './types'

const row: ProviderRow = { id: 'x', type: 'openai-compatible', name: 'X', baseUrl: 'https://api.example.com/v1/', keyCipher: null, contextSize: 64000 }
const signal = () => new AbortController().signal
const user = (text: string): ChatMessage => ({ role: 'user', parts: [{ type: 'text', text }] })
const delta = (d: unknown) => ({ choices: [{ index: 0, delta: d }] })

describe('openai-compatible', () => {
  it('streamStep emite text, tool-call con argumentos ensamblados y finish', async () => {
    const f = fakeFetch({
      '/chat/completions': () =>
        new Response(
          sse([
            delta({ role: 'assistant', content: 'Hola' }),
            delta({ content: ' mundo', reasoning_content: 'x' }),
            delta({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'edit_file', arguments: '{"path":' } }] }),
            delta({ tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }),
            delta({ tool_calls: [{ index: 1, id: 'call_2', function: { name: 'list_dir', arguments: '' } }] }),
            { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
            { choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } },
          ]),
        ),
    })
    const events = await collect(createProvider(row, null, f.impl).createModel('m').streamStep({ messages: [user('x')], tools: [], signal: signal() }))
    expect(events).toEqual([
      { type: 'text', delta: 'Hola' },
      { type: 'text', delta: ' mundo' },
      { type: 'tool-call', callId: 'call_1', name: 'edit_file', input: { path: 'a.ts' } },
      { type: 'tool-call', callId: 'call_2', name: 'list_dir', input: {} },
      { type: 'finish', inputTokens: 50, outputTokens: 9 },
    ])
  })

  it('argumentos JSON inválidos → tool-call con el texto crudo', async () => {
    const f = fakeFetch({
      '/chat/completions': () =>
        new Response(sse([delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'read_file', arguments: '{"path": a.ts' } }] })])),
    })
    const events = await collect(createProvider(row, null, f.impl).createModel('m').streamStep({ messages: [user('x')], tools: [], signal: signal() }))
    expect(events[0]).toEqual({ type: 'tool-call', callId: 'c', name: 'read_file', input: '{"path": a.ts' })
    expect(events[1]).toEqual({ type: 'finish', inputTokens: null, outputTokens: null })
  })

  it('envía Authorization, el historial en formato OpenAI y las herramientas', async () => {
    const f = fakeFetch({ '/chat/completions': () => new Response(sse([])) })
    const messages: ChatMessage[] = [
      { role: 'system', parts: [{ type: 'text', text: 'sys' }] },
      user('hola'),
      { role: 'assistant', parts: [{ type: 'tool-call', callId: 'c1', name: 'read_file', input: { path: 'a' } }] },
      { role: 'tool', parts: [{ type: 'tool-result', callId: 'c1', output: 'out', isError: false }] },
    ]
    const tools = [{ name: 'read_file', description: 'd', parameters: { type: 'object' } }]
    await collect(createProvider(row, 'sk-123', f.impl).createModel('m').streamStep({ messages, tools, signal: signal() }))
    const call = f.calls[0]!
    expect(call.url).toBe('https://api.example.com/v1/chat/completions')
    expect(call.headers.authorization).toBe('Bearer sk-123')
    expect(call.body).toMatchObject({
      model: 'm',
      stream: true,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'out' },
      ],
      tools: [{ type: 'function', function: { name: 'read_file', description: 'd', parameters: { type: 'object' } } }],
    })
  })

  it('sin clave no envía Authorization y sin herramientas no envía tools', async () => {
    const f = fakeFetch({ '/chat/completions': () => new Response(sse([])) })
    await collect(createProvider(row, null, f.impl).createModel('m').streamStep({ messages: [user('x')], tools: [], signal: signal() }))
    expect(f.calls[0]!.headers.authorization).toBeUndefined()
    expect(f.calls[0]!.body.tools).toBeUndefined()
  })

  it('listModels lee /models y capabilities usa el tamaño configurado', async () => {
    const f = fakeFetch({ '/v1/models': () => json({ data: [{ id: 'a' }, { id: 'b' }] }) })
    const p = createProvider(row, null, f.impl)
    expect(await p.listModels()).toEqual(['a', 'b'])
    expect(await p.getCapabilities('a')).toEqual({ tools: 'unknown', contextWindow: 64000 })
  })

  it('LM Studio lee max_context_length de /api/v0/models y cae al valor configurado si falla', async () => {
    const lm: ProviderRow = { ...row, type: 'lmstudio', baseUrl: 'http://localhost:1234/v1', contextSize: null }
    const f = fakeFetch({ '/api/v0/models': () => json({ data: [{ id: 'qwen', max_context_length: 131072 }] }) })
    expect(await createProvider(lm, null, f.impl).getCapabilities('qwen')).toEqual({ tools: 'unknown', contextWindow: 131072 })
    expect(f.calls[0]!.url).toBe('http://localhost:1234/api/v0/models')
    const g = fakeFetch({})
    expect(await createProvider(lm, null, g.impl).getCapabilities('qwen')).toEqual({ tools: 'unknown', contextWindow: null })
  })
})
