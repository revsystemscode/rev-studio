import type { Capabilities, Part } from '@rev/protocol'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  parts: Part[]
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema de los argumentos. */
  parameters: Record<string, unknown>
}

export type StepEvent =
  | { type: 'text'; delta: string }
  /** `input` es el objeto de argumentos, o el texto crudo si el modelo emitió JSON inválido. */
  | { type: 'tool-call'; callId: string; name: string; input: unknown }
  | { type: 'finish'; inputTokens: number | null; outputTokens: number | null }

export interface StepRequest {
  messages: ChatMessage[]
  tools: ToolSpec[]
  signal: AbortSignal
}

/** Una llamada al modelo. Si la señal se aborta, el iterador termina sin lanzar. */
export interface ModelClient {
  streamStep(req: StepRequest): AsyncIterable<StepEvent>
}

export interface Provider {
  listModels(): Promise<string[]>
  getCapabilities(model: string): Promise<Capabilities>
  createModel(model: string): ModelClient
  ping(): Promise<boolean>
}

export class ProviderUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderUnreachableError'
  }
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}

export function textOf(message: ChatMessage): string {
  return message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
}
