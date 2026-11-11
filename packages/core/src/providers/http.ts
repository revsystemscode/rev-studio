import { ProviderHttpError, ProviderUnreachableError } from './types'

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/** fetch que distingue "no se pudo conectar" de un error HTTP con respuesta. */
export async function request(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(url, init)
  } catch (e) {
    if (isAbort(e)) throw e
    throw new ProviderUnreachableError(`No se pudo conectar con ${new URL(url).host}.`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = text.slice(0, 500)
    try {
      const parsed = JSON.parse(text)
      detail = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? detail)
    } catch {
      // No era JSON: se usa el texto tal cual.
    }
    throw new ProviderHttpError(res.status, `El proveedor respondió ${res.status}: ${detail || res.statusText}`)
  }
  return res
}

export async function getJson(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<any> {
  return (await request(fetchImpl, url, init)).json()
}

export function postJson(fetchImpl: typeof fetch, url: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return request(fetchImpl, url, {
    ...init,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: JSON.stringify(body),
  })
}

/** Líneas de texto de un cuerpo en streaming, sin importar cómo lleguen troceados los bytes. */
export async function* lines(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (line) yield line
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) yield buffer
}

/** Ejecuta un stream de modelo y lo termina en silencio si la señal se abortó. */
export async function* untilAborted<T>(signal: AbortSignal, run: () => AsyncGenerator<T>): AsyncGenerator<T> {
  if (signal.aborted) return
  try {
    yield* run()
  } catch (e) {
    if (signal.aborted || isAbort(e)) return
    throw e
  }
}
