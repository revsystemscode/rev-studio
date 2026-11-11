import { ProviderHttpError, type ModelClient } from './types'

/** Comprueba con una llamada real si el modelo sabe usar herramientas. */
export async function probeTools(client: ModelClient, signal = AbortSignal.timeout(60_000)): Promise<'yes' | 'no'> {
  try {
    for await (const event of client.streamStep({
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Call the ping tool.' }] }],
      tools: [{ name: 'ping', description: 'Replies with pong.', parameters: { type: 'object', properties: {} } }],
      signal,
    })) {
      if (event.type === 'tool-call') return 'yes'
    }
    return 'no'
  } catch (e) {
    // Muchos servidores rechazan con 400 las peticiones con herramientas a modelos que no las admiten.
    if (e instanceof ProviderHttpError && e.status >= 400 && e.status < 500) return 'no'
    throw e
  }
}
