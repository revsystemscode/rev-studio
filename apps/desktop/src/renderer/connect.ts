import { CoreClient } from './client'

/**
 * Mantiene la conexión con el core. `onClient` se llama con un cliente nuevo al arrancar
 * y cada vez que el core se reinicia; el cliente anterior queda cerrado.
 */
export function connectCore(onClient: (client: CoreClient) => void): () => void {
  let current: CoreClient | null = null
  const listener = (event: MessageEvent) => {
    if (event.source !== window || event.data !== 'rev-core-port' || !event.ports[0]) return
    current?.close()
    current = new CoreClient(event.ports[0])
    onClient(current)
  }
  window.addEventListener('message', listener)
  void window.rev.requestCorePort()
  return () => {
    window.removeEventListener('message', listener)
    current?.close()
  }
}
