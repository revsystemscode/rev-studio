import {
  EventEnvelopeSchema,
  ResponseSchema,
  type CoreEvent,
  type ErrorCode,
  type MethodName,
  type ParamsOf,
  type ResultOf,
} from '@rev/protocol'

export class CoreCallError extends Error {
  constructor(
    readonly code: ErrorCode | 'disconnected',
    message: string,
  ) {
    super(message)
    this.name = 'CoreCallError'
  }
}

const DISCONNECTED = 'Se perdió la conexión con el motor de Rev Studio.'

/** Cliente del protocolo sobre un MessagePort: peticiones con respuesta y eventos del core. */
export class CoreClient {
  private nextId = 0
  private closed = false
  private readonly pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  private readonly listeners = new Set<(e: CoreEvent) => void>()

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', (ev) => this.receive((ev as MessageEvent).data))
    port.start()
  }

  call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    if (this.closed) return Promise.reject(new CoreCallError('disconnected', DISCONNECTED))
    const id = ++this.nextId
    return new Promise<ResultOf<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.port.postMessage({ id, method, params })
    })
  }

  onEvent(cb: (e: CoreEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.port.close()
    for (const p of this.pending.values()) p.reject(new CoreCallError('disconnected', DISCONNECTED))
    this.pending.clear()
    this.listeners.clear()
  }

  private receive(data: unknown): void {
    const event = EventEnvelopeSchema.safeParse(data)
    if (event.success) {
      for (const cb of this.listeners) cb(event.data.event)
      return
    }
    const response = ResponseSchema.safeParse(data)
    if (!response.success) {
      console.warn('Mensaje del core ignorado por no cumplir el protocolo', data)
      return
    }
    const pending = this.pending.get(response.data.id)
    if (!pending) return
    this.pending.delete(response.data.id)
    if ('error' in response.data) pending.reject(new CoreCallError(response.data.error.code, response.data.error.message))
    else pending.resolve(response.data.result)
  }
}
