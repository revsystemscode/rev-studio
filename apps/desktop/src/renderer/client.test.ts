import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { CoreCallError, CoreClient } from './client'

const open: MessageChannel[] = []
afterEach(() => {
  for (const c of open.splice(0)) {
    c.port1.close()
    c.port2.close()
  }
})

/** `server` hace de core: recibe las peticiones y contesta lo que la prueba decida. */
function pair() {
  const channel = new MessageChannel()
  open.push(channel)
  const client = new CoreClient(channel.port1 as unknown as MessagePort)
  const requests: any[] = []
  const server = channel.port2
  server.on('message', (m) => requests.push(m))
  const nextRequest = async () => {
    while (requests.length === 0) await new Promise((r) => setTimeout(r, 5))
    return requests.shift()
  }
  return { client, server, nextRequest }
}
const tick = () => new Promise((r) => setTimeout(r, 30))

describe('CoreClient', () => {
  it('call resuelve con el result de la respuesta que lleva su mismo id', async () => {
    const { client, server, nextRequest } = pair()
    const first = client.call('projects.list', {})
    const second = client.call('settings.get', {})
    const a = await nextRequest()
    const b = await nextRequest()
    expect(a).toMatchObject({ method: 'projects.list', params: {} })
    server.postMessage({ id: b.id, result: { defaultProviderId: null, defaultModel: 'm' } })
    server.postMessage({ id: a.id, result: [] })
    expect(await first).toEqual([])
    expect(await second).toEqual({ defaultProviderId: null, defaultModel: 'm' })
  })

  it('call rechaza con CoreCallError y su código', async () => {
    const { client, server, nextRequest } = pair()
    const pending = client.call('sessions.get', { id: 'x' })
    server.postMessage({ id: (await nextRequest()).id, error: { code: 'not_found', message: 'No existe la sesión.' } })
    const error = await pending.catch((e) => e)
    expect(error).toBeInstanceOf(CoreCallError)
    expect(error).toMatchObject({ code: 'not_found', message: 'No existe la sesión.' })
  })

  it('onEvent entrega los eventos válidos e ignora los inválidos; la baja deja de recibir', async () => {
    const { client, server } = pair()
    const seen: unknown[] = []
    const off = client.onEvent((e) => seen.push(e))
    server.postMessage({ event: { type: 'nope' } })
    server.postMessage('basura')
    server.postMessage({ event: { type: 'text.delta', sessionId: 's', delta: 'hola' } })
    await tick()
    expect(seen).toEqual([{ type: 'text.delta', sessionId: 's', delta: 'hola' }])
    off()
    server.postMessage({ event: { type: 'text.delta', sessionId: 's', delta: 'más' } })
    await tick()
    expect(seen).toHaveLength(1)
  })

  it('close rechaza las llamadas pendientes y las posteriores', async () => {
    const { client } = pair()
    const pending = client.call('projects.list', {})
    client.close()
    await expect(pending).rejects.toThrow(/conexión/i)
    await expect(client.call('projects.list', {})).rejects.toThrow(/conexión/i)
  })
})
