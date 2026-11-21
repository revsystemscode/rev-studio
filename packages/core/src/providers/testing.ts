// Utilidades de prueba: fetch simulado con respuestas en streaming.
export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

/** Trocea el texto en fragmentos pequeños para ejercitar el ensamblado de líneas partidas. */
export function streamOf(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close()
      controller.enqueue(bytes.subarray(offset, offset + chunkSize))
      offset += chunkSize
    },
  })
}

export const ndjson = (objects: unknown[]) => streamOf(objects.map((o) => JSON.stringify(o)).join('\n') + '\n')
export const sse = (objects: unknown[]) =>
  streamOf(objects.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('') + 'data: [DONE]\n\n')

type Handler = (call: Call) => Response | Promise<Response>

export function fakeFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const key = Object.keys(routes).find((k) => url.endsWith(k))
    if (!key) return new Response('not found', { status: 404 })
    return routes[key]!(call)
  }) as typeof fetch
  return { impl, calls }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}
