import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { decryptSecret } from './secrets'

const RESTART_DELAY_MS = 500
const CRASH_WINDOW_MS = 60_000
const MAX_CRASHES = 3

export interface CoreProcessOptions {
  entry: string
  env: Record<string, string>
  /** El core se reinició tras una caída: hay que entregar un canal nuevo a las ventanas. */
  onRestart(): void
  /** Demasiadas caídas seguidas: no se reintenta más. */
  onGiveUp(): void
  /** El core no puede arrancar (p. ej. base de datos inservible): reintentar no ayuda. */
  onFatal(message: string, backupPath: string | null): void
}

/** Arranca el core en un proceso aparte, lo reinicia si se cae y le sirve el descifrado de claves. */
export class CoreProcess {
  private child: UtilityProcess | null = null
  private ready = false
  private stopping = false
  private dead = false
  private crashes: number[] = []
  private waiters: { resolve(): void; reject(e: Error): void }[] = []

  constructor(private readonly opts: CoreProcessOptions) {}

  /** Se resuelve cuando el core está listo para recibir peticiones. */
  start(): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }))
    this.fork()
    return promise
  }

  private fork(): void {
    this.ready = false
    const child = utilityProcess.fork(this.opts.entry, [], {
      env: { ...process.env, ...this.opts.env },
      serviceName: 'rev-core',
      stdio: 'inherit',
    })
    this.child = child

    child.on('message', (msg: any) => {
      if (msg?.type === 'ready') {
        this.ready = true
        for (const w of this.waiters.splice(0)) w.resolve()
      } else if (msg?.type === 'decrypt') {
        try {
          child.postMessage({ type: 'decrypted', id: msg.id, plain: decryptSecret(msg.cipher) })
        } catch (e) {
          child.postMessage({ type: 'decrypted', id: msg.id, error: e instanceof Error ? e.message : String(e) })
        }
      } else if (msg?.type === 'fatal') {
        this.fail(new Error(msg.message))
        this.opts.onFatal(msg.message, msg.backupPath ?? null)
      }
    })

    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      if (this.stopping || this.dead) return
      const now = Date.now()
      this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now]
      if (this.crashes.length >= MAX_CRASHES) {
        this.fail(new Error('El core se cae repetidamente.'))
        this.opts.onGiveUp()
        return
      }
      const wasReady = this.ready
      setTimeout(() => {
        if (this.stopping || this.dead) return
        if (wasReady) this.waiters.push({ resolve: () => this.opts.onRestart(), reject: () => {} })
        this.fork()
      }, RESTART_DELAY_MS)
    })
  }

  private fail(error: Error): void {
    this.dead = true
    for (const w of this.waiters.splice(0)) w.reject(error)
  }

  /** Crea un canal directo entre una ventana y el core. */
  connect(webContents: WebContents): void {
    if (!this.child || !this.ready || webContents.isDestroyed()) return
    const { port1, port2 } = new MessageChannelMain()
    this.child.postMessage({ type: 'port' }, [port1])
    webContents.postMessage('core-port', null, [port2])
  }

  stop(): void {
    this.stopping = true
    this.child?.kill()
  }
}
