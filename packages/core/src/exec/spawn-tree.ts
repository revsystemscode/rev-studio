import { spawn } from 'node:child_process'

export interface RunResult {
  exitCode: number | null
  output: string
  timedOut: boolean
  aborted: boolean
  /** Bytes de salida descartados por superar `maxBytes`. */
  truncatedBytes: number
}

export interface RunOptions {
  file: string
  args: string[]
  cwd: string
  timeoutMs: number
  signal: AbortSignal
  /** Máximo de salida retenida en memoria: mitad inicial y mitad final. */
  maxBytes?: number
}

export const DEFAULT_MAX_BYTES = 1_048_576

/**
 * `powershell -Command` termina con 0 o 1 según el último comando haya ido bien o no, y pierde el
 * código real de un programa (p. ej. 2 en `npm test`). El envoltorio sale con `$LASTEXITCODE` si un
 * programa lo fijó, o con 1 si falló un cmdlet.
 */
function powershellScript(command: string): string {
  return [
    '$global:LASTEXITCODE = $null',
    command,
    '$ok = $?',
    'if ($null -ne $global:LASTEXITCODE) { exit $global:LASTEXITCODE }',
    'if (-not $ok) { exit 1 }',
  ].join('\n')
}

/** Cómo ejecutar una línea de comando en la shell del usuario de cada plataforma. */
export function shellInvocation(
  command: string,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  if (platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', powershellScript(command)] }
  }
  // Shell de login: hereda el PATH del usuario aunque la app se haya abierto desde Finder.
  return { file: '/bin/zsh', args: ['-lc', command] }
}

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
    return
  }
  try {
    // El hijo es líder de su grupo (detached): el pid negativo alcanza a todos sus descendientes.
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Ya había terminado.
  }
}

/** Acumula salida sin crecer sin límite: guarda el principio y, en un búfer rodante, el final. */
class BoundedOutput {
  private head: Buffer[] = []
  private headBytes = 0
  private tail: Buffer[] = []
  private tailBytes = 0
  private total = 0
  private readonly half: number

  constructor(maxBytes: number) {
    this.half = Math.floor(maxBytes / 2)
  }

  push(chunk: Buffer): void {
    this.total += chunk.length
    if (this.headBytes < this.half) {
      const take = chunk.subarray(0, this.half - this.headBytes)
      this.head.push(take)
      this.headBytes += take.length
      chunk = chunk.subarray(take.length)
      if (chunk.length === 0) return
    }
    this.tail.push(chunk)
    this.tailBytes += chunk.length
    while (this.tailBytes - this.tail[0]!.length >= this.half) {
      this.tailBytes -= this.tail.shift()!.length
    }
  }

  result(): { output: string; truncatedBytes: number } {
    let tail = Buffer.concat(this.tail)
    if (tail.length > this.half) tail = tail.subarray(tail.length - this.half)
    const truncatedBytes = this.total - this.headBytes - tail.length
    const head = Buffer.concat(this.head).toString('utf8')
    if (truncatedBytes === 0) return { output: head + tail.toString('utf8'), truncatedBytes }
    return { output: `${head}\n[… ${truncatedBytes} bytes omitidos …]\n${tail.toString('utf8')}`, truncatedBytes }
  }
}

/** Ejecuta un proceso sin terminal y garantiza que él y sus descendientes mueren al cancelar o agotar el tiempo. */
export function runProcess(opts: RunOptions): Promise<RunResult> {
  const out = new BoundedOutput(opts.maxBytes ?? DEFAULT_MAX_BYTES)
  if (opts.signal.aborted) {
    return Promise.resolve({ exitCode: null, output: '', timedOut: false, aborted: true, truncatedBytes: 0 })
  }

  return new Promise((resolve, reject) => {
    const child = spawn(opts.file, opts.args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })

    let timedOut = false
    let aborted = false
    let settled = false
    let forceTimer: NodeJS.Timeout | undefined

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      opts.signal.removeEventListener('abort', onAbort)
      resolve({ exitCode, timedOut, aborted, ...out.result() })
    }
    const kill = () => {
      if (child.pid !== undefined) killTree(child.pid)
      // Si algún descendiente sobrevive con las tuberías abiertas, 'close' no llegaría nunca.
      forceTimer = setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
        finish(null)
      }, 2000)
    }
    const onAbort = () => {
      aborted = true
      kill()
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, opts.timeoutMs)

    opts.signal.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (c: Buffer) => out.push(c))
    child.stderr.on('data', (c: Buffer) => out.push(c))
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', (code) => finish(timedOut || aborted ? null : code))
  })
}
