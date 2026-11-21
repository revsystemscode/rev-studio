import type { Capabilities } from '@rev/protocol'
import type { ProviderRow } from '../db/repos/providers'
import { getJson, lines, postJson, untilAborted } from './http'
import { textOf, type ChatMessage, type ModelClient, type Provider, type StepEvent } from './types'

function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      for (const p of m.parts) {
        if (p.type === 'tool-result') out.push({ role: 'tool', tool_call_id: p.callId, content: p.output })
      }
      continue
    }
    const calls = m.parts.flatMap((p) => (p.type === 'tool-call' ? [p] : []))
    if (calls.length === 0) {
      out.push({ role: m.role, content: textOf(m) })
      continue
    }
    out.push({
      role: m.role,
      content: textOf(m) || null,
      tool_calls: calls.map((c) => ({
        id: c.callId,
        type: 'function',
        function: { name: c.name, arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input ?? {}) },
      })),
    })
  }
  return out
}

function parseArguments(raw: string): unknown {
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw)
  } catch {
    // El agente valida la entrada y le devuelve el error al modelo.
    return raw
  }
}

/** Cliente de la API de chat con formato OpenAI (LM Studio, OpenRouter, Groq, llama-server…). */
export function openAiCompatibleProvider(row: ProviderRow, apiKey: string | null, fetchImpl: typeof fetch): Provider {
  const base = row.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {}

  const listModels = async (init: RequestInit = {}): Promise<string[]> => {
    const data = await getJson(fetchImpl, `${base}/models`, { ...init, headers })
    return (data.data ?? []).map((m: { id: string }) => m.id)
  }

  return {
    listModels: () => listModels(),
    ping: () => listModels({ signal: AbortSignal.timeout(1500) }).then(() => true, () => false),
    async getCapabilities(model): Promise<Capabilities> {
      let contextWindow = row.contextSize
      if (row.type === 'lmstudio') {
        // API propia de LM Studio; si no está o cambia de forma, se usa el valor configurado.
        try {
          const data = await getJson(fetchImpl, `${new URL(base).origin}/api/v0/models`, { headers })
          const max = (data.data ?? []).find((m: { id: string }) => m.id === model)?.max_context_length
          if (typeof max === 'number' && max > 0) contextWindow = Math.min(max, row.contextSize ?? Infinity)
        } catch {
          // Se conserva row.contextSize.
        }
      }
      return { tools: 'unknown', contextWindow }
    },
    createModel(model): ModelClient {
      return {
        streamStep: ({ messages, tools, signal }) =>
          untilAborted(signal, async function* (): AsyncGenerator<StepEvent> {
            const res = await postJson(
              fetchImpl,
              `${base}/chat/completions`,
              {
                model,
                stream: true,
                stream_options: { include_usage: true },
                messages: toOpenAiMessages(messages),
                ...(tools.length > 0 && { tools: tools.map((t) => ({ type: 'function', function: t })) }),
              },
              { signal, headers },
            )

            // Los argumentos de cada llamada llegan en fragmentos, identificados por su índice.
            const calls = new Map<number, { id: string; name: string; args: string }>()
            let inputTokens: number | null = null
            let outputTokens: number | null = null

            for await (const line of lines(res.body)) {
              if (!line.startsWith('data:')) continue
              const data = line.slice(5).trim()
              if (data === '[DONE]') break
              const chunk = JSON.parse(data)
              if (chunk.error) throw new Error(`El proveedor devolvió un error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`)
              if (chunk.usage) {
                inputTokens = chunk.usage.prompt_tokens ?? null
                outputTokens = chunk.usage.completion_tokens ?? null
              }
              const delta = chunk.choices?.[0]?.delta
              if (!delta) continue
              if (delta.content) yield { type: 'text', delta: delta.content }
              for (const tc of delta.tool_calls ?? []) {
                const index: number = tc.index ?? 0
                const call = calls.get(index) ?? { id: '', name: '', args: '' }
                if (tc.id) call.id = tc.id
                if (tc.function?.name) call.name += tc.function.name
                if (tc.function?.arguments) call.args += tc.function.arguments
                calls.set(index, call)
              }
            }

            for (const [index, call] of [...calls].sort(([a], [b]) => a - b)) {
              yield { type: 'tool-call', callId: call.id || `call_${index}`, name: call.name, input: parseArguments(call.args) }
            }
            yield { type: 'finish', inputTokens, outputTokens }
          }),
      }
    },
  }
}
