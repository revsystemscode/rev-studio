import { readFileSync } from 'node:fs'
import type { ChatMessage, ModelClient, Provider, StepEvent, StepRequest, ToolSpec } from './types'

/** Modelo guionizado para pruebas: cada llamada reproduce el siguiente paso del guion. */
export class FakeModelClient implements ModelClient {
  readonly requests: ChatMessage[][] = []
  readonly toolRequests: ToolSpec[][] = []
  private step = 0

  constructor(
    private readonly script: StepEvent[][],
    /** Pausa entre eventos, para pruebas que necesitan interrumpir a mitad de un paso. */
    private readonly delayMs = 0,
  ) {}

  async *streamStep(req: StepRequest): AsyncGenerator<StepEvent> {
    this.requests.push(structuredClone(req.messages))
    this.toolRequests.push(req.tools)
    const events = this.script[this.step++] ?? [
      { type: 'text', delta: 'fin' },
      { type: 'finish', inputTokens: null, outputTokens: null },
    ]
    for (const event of events) {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
      if (req.signal.aborted) return
      yield event
    }
  }
}

export function loadFakeScript(path: string): StepEvent[][] {
  return JSON.parse(readFileSync(path, 'utf8')) as StepEvent[][]
}

export const FAKE_MODEL = 'fake-model'

export function fakeProvider(scriptPath: string): Provider {
  return {
    listModels: async () => [FAKE_MODEL],
    getCapabilities: async () => ({ tools: 'yes', contextWindow: 32_768 }),
    ping: async () => true,
    createModel: () => new FakeModelClient(loadFakeScript(scriptPath)),
  }
}
