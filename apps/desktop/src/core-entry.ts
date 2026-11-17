// Punto de entrada del utilityProcess: conecta @rev/core con el proceso principal de Electron.
import { MigrationError, startCore } from '@rev/core'
import type { MessagePortMain } from 'electron'

const parent = process.parentPort
let port: MessagePortMain | null = null
let handler: ((msg: unknown) => void) | null = null
const early: unknown[] = []
const decrypts = new Map<number, { resolve(plain: string): void; reject(e: Error): void }>()
let nextDecrypt = 0

parent.on('message', (e) => {
  const msg = e.data
  if (msg?.type === 'port') {
    // Cada ventana (o recarga) trae un canal nuevo; el anterior deja de usarse.
    port?.close()
    port = e.ports[0] ?? null
    port?.on('message', (ev) => (handler ? handler(ev.data) : early.push(ev.data)))
    port?.start()
  } else if (msg?.type === 'decrypted') {
    const pending = decrypts.get(msg.id)
    decrypts.delete(msg.id)
    if (typeof msg.plain === 'string') pending?.resolve(msg.plain)
    else pending?.reject(new Error(msg.error ?? 'No se pudo descifrar la clave.'))
  }
})

const env = process.env
startCore({
  dbPath: env.REV_DB_PATH!,
  rgPath: env.REV_RG_PATH!,
  fake: env.REV_STUDIO_FAKE_SCRIPT ? { scriptPath: env.REV_STUDIO_FAKE_SCRIPT, asDefault: true } : undefined,
  decrypt: (cipher) =>
    new Promise((resolve, reject) => {
      const id = ++nextDecrypt
      decrypts.set(id, { resolve, reject })
      parent.postMessage({ type: 'decrypt', id, cipher })
    }),
  transport: {
    post: (msg) => port?.postMessage(msg),
    onMessage(cb) {
      handler = cb
      for (const msg of early.splice(0)) cb(msg)
    },
  },
}).then(
  () => parent.postMessage({ type: 'ready' }),
  (e) => {
    parent.postMessage({
      type: 'fatal',
      message: e instanceof Error ? e.message : String(e),
      backupPath: e instanceof MigrationError ? e.backupPath : null,
    })
  },
)
