import { randomUUID } from 'node:crypto'
import type { Capabilities } from '@rev/protocol'
import type { ProviderRow } from '../db/repos/providers'
import { getJson, lines, postJson, untilAborted } from './http'
import { ProviderHttpError, textOf, type ChatMessage, type ModelClient, type Provider, type StepEvent } from './types'

/** Ollama carga los modelos con una ventana pequeña salvo que se le pida otra; un agente necesita más. */
export const DEFAULT_OLLAMA_CONTEXT = 32_768

function toOllamaMessages(messages: ChatMessage[]): unknown[] {
  const toolNames = new Map<string, string>()
  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      for (const p of m.parts) {
        if (p.type === 'tool-result') out.push({ role: 'tool', content: p.output, tool_name: toolNames.get(p.callId) ?? '' })
      }
      continue
    }
    const calls = m.parts.flatMap((p) => (p.type === 'tool-call' ? [p] : []))
    for (const c of calls) toolNames.set(c.callId, c.name)
    out.push({
      role: m.role,
      content: textOf(m),
      ...(calls.length > 0 && {
        tool_calls: calls.map((c) => ({
          function: { name: c.name, arguments: typeof c.input === 'object' && c.input !== null ? c.input : {} },
        })),
      }),
    })
  }
  return out
}

export function ollamaProvider(row: ProviderRow, fetchImpl: typeof fetch): Provider {
  const base = row.baseUrl.replace(/\/+$/, '')
  const capabilities = new Map<string, Promise<Capabilities>>()

  // La ventana que se informa es la que la app pedirá de verdad (num_ctx), no el máximo teórico del modelo.
  const getCapabilities = (model: string): Promise<Capabilities> => {
    let cached = capabilities.get(model)
    if (!cached) {
      cached = postJson(fetchImpl, `${base}/api/show`, { model })
        .then((r) => r.json() as Promise<any>)
        .then((info): Capabilities => {
          const entry = Object.entries(info.model_info ?? {}).find(([k]) => k.endsWith('.context_length'))
          const modelMax = typeof entry?.[1] === 'number' && entry[1] > 0 ? entry[1] : Infinity
          const window = Math.min(row.contextSize ?? DEFAULT_OLLAMA_CONTEXT, modelMax)
          const caps: unknown = info.capabilities
          return { tools: Array.isArray(caps) && caps.includes('tools') ? 'yes' : 'no', contextWindow: window }
        })
      cached.catch(() => capabilities.delete(model))
      capabilities.set(model, cached)
    }
    return cached
  }

  return {
    async listModels() {
      const data = await getJson(fetchImpl, `${base}/api/tags`)
      return (data.models ?? []).map((m: { name: string }) => m.name)
    },
    getCapabilities,
    async ping() {
      return getJson(fetchImpl, `${base}/api/tags`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)
    },
    createModel(model): ModelClient {
      return {
        streamStep: ({ messages, tools, signal }) =>
          untilAborted(signal, async function* (): AsyncGenerator<StepEvent> {
            const { contextWindow: numCtx } = await getCapabilities(model)
            const res = await postJson(
              fetchImpl,
              `${base}/api/chat`,
              {
                model,
                stream: true,
                messages: toOllamaMessages(messages),
                ...(tools.length > 0 && { tools: tools.map((t) => ({ type: 'function', function: t })) }),
                options: { num_ctx: numCtx },
              },
              { signal },
            )
            for await (const line of lines(res.body)) {
              const chunk = JSON.parse(line)
              if (chunk.error) throw new ProviderHttpError(500, `Ollama: ${chunk.error}`)
              const content = chunk.message?.content
              if (content) yield { type: 'text', delta: content }
              for (const call of chunk.message?.tool_calls ?? []) {
                yield { type: 'tool-call', callId: randomUUID(), name: call.function?.name ?? '', input: call.function?.arguments ?? {} }
              }
              if (chunk.done) {
                yield { type: 'finish', inputTokens: chunk.prompt_eval_count ?? null, outputTokens: chunk.eval_count ?? null }
                return
              }
            }
            yield { type: 'finish', inputTokens: null, outputTokens: null }
          }),
      }
    },
  }
}
