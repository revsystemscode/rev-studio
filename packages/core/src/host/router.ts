import { methods, RequestSchema, type MethodName, type ResultOf } from '@rev/protocol'
import type { z } from 'zod'
import { toWireError } from './errors'

export type Handlers = {
  [M in MethodName]: (params: z.output<(typeof methods)[M]['params']>) => ResultOf<M> | Promise<ResultOf<M>>
}

/** Valida cada petición y su respuesta contra el protocolo; nunca deja una petición sin contestar. */
export function createRouter(handlers: Handlers, post: (msg: unknown) => void) {
  return async function handle(raw: unknown): Promise<void> {
    const request = RequestSchema.safeParse(raw)
    if (!request.success) return
    const { id, method, params } = request.data
    const fail = (error: ReturnType<typeof toWireError>) => post({ id, error })

    if (!Object.hasOwn(methods, method)) return fail({ code: 'not_found', message: `Método desconocido: ${method}` })
    const spec = methods[method as MethodName]
    const parsed = spec.params.safeParse(params)
    if (!parsed.success) return fail({ code: 'invalid_params', message: `Parámetros inválidos para ${method}.` })

    try {
      const handler = handlers[method as MethodName] as (p: unknown) => unknown
      const result = spec.result.safeParse(await handler(parsed.data))
      if (!result.success) return fail({ code: 'internal', message: `Respuesta inválida de ${method}.` })
      post({ id, result: result.data })
    } catch (e) {
      fail(toWireError(e))
    }
  }
}
