import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupProjects, makeProject } from '../testing/project'
import { runProcess, shellInvocation } from './spawn-tree'

afterEach(cleanupProjects)

function sh(command: string, cwd: string, opts: { timeoutMs?: number; signal?: AbortSignal; maxBytes?: number } = {}) {
  return runProcess({
    ...shellInvocation(command),
    cwd,
    timeoutMs: opts.timeoutMs ?? 15_000,
    signal: opts.signal ?? new AbortController().signal,
    maxBytes: opts.maxBytes,
  })
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('runProcess', () => {
  it('captura stdout, stderr y el código de salida', async () => {
    const p = makeProject({ 's.js': "console.log('fuera'); console.error('error'); process.exit(3)" })
    const r = await sh('node s.js', p.root)
    expect(r.output).toContain('fuera')
    expect(r.output).toContain('error')
    expect(r).toMatchObject({ exitCode: 3, timedOut: false, aborted: false, truncatedBytes: 0 })
  })

  it('agota el tiempo y resuelve pronto', async () => {
    const p = makeProject({ 's.js': "console.log('inicio'); setTimeout(() => {}, 60000)" })
    const started = Date.now()
    const r = await sh('node s.js', p.root, { timeoutMs: 1500 })
    expect(r.timedOut).toBe(true)
    expect(r.output).toContain('inicio')
    expect(Date.now() - started).toBeLessThan(4500)
  })

  it('abortar mata el proceso', async () => {
    const p = makeProject({ 's.js': 'setTimeout(() => {}, 60000)' })
    const abort = new AbortController()
    setTimeout(() => abort.abort(), 500)
    const r = await sh('node s.js', p.root, { signal: abort.signal })
    expect(r.aborted).toBe(true)
    expect(r.timedOut).toBe(false)
  })

  it('con la señal ya abortada no llega a ejecutar nada', async () => {
    const p = makeProject({ 's.js': "require('fs').writeFileSync('huella.txt', 'x')" })
    const abort = new AbortController()
    abort.abort()
    const r = await sh('node s.js', p.root, { signal: abort.signal })
    expect(r.aborted).toBe(true)
    await new Promise((res) => setTimeout(res, 300))
    expect(await sh('node -e "console.log(require(\'fs\').existsSync(\'huella.txt\'))"', p.root)).toMatchObject({
      output: expect.stringContaining('false'),
    })
  })

  it('mata también a los nietos', async () => {
    const p = makeProject({
      'nieto.js': 'setTimeout(() => {}, 60000)',
      'hijo.js': `
        const { spawn } = require('child_process')
        const nieto = spawn(process.execPath, ['nieto.js'], { stdio: 'ignore' })
        console.log('PID=' + nieto.pid)
        setTimeout(() => {}, 60000)`,
    })
    const abort = new AbortController()
    const pending = sh('node hijo.js', p.root, { signal: abort.signal })
    await new Promise((res) => setTimeout(res, 1500))
    abort.abort()
    const r = await pending
    const pid = Number(/PID=(\d+)/.exec(r.output)?.[1])
    expect(pid).toBeGreaterThan(0)
    await new Promise((res) => setTimeout(res, 500))
    expect(alive(pid)).toBe(false)
  })

  it('una salida infinita no supera el límite y conserva principio y final', async () => {
    const p = makeProject({ 's.js': "console.log('PRIMERA'); for (;;) console.log('x'.repeat(1000))" })
    const r = await sh('node s.js', p.root, { timeoutMs: 2000, maxBytes: 100_000 })
    expect(r.timedOut).toBe(true)
    expect(r.truncatedBytes).toBeGreaterThan(0)
    expect(r.output.length).toBeLessThan(101_000)
    expect(r.output.startsWith('PRIMERA')).toBe(true)
    expect(r.output).toMatch(/\[… \d+ bytes omitidos …\]/)
  })

  it('funciona en una carpeta con espacios y caracteres no ASCII', async () => {
    const p = makeProject({ 's.js': 'console.log(process.cwd())' }, 'Mis proyectos/José')
    const r = await sh('node s.js', p.root)
    expect(r.exitCode).toBe(0)
    expect(r.output).toContain('José')
  })

  // PowerShell 5.1 escribe la salida de sus cmdlets en la página de códigos OEM (850 en español).
  it.runIf(process.platform === 'win32')('en Windows la salida de PowerShell conserva los acentos', async () => {
    const p = makeProject({}, 'Mis proyectos/José')
    const r = await sh("Write-Output 'José año'; (Get-Location).Path", p.root)
    expect(r.exitCode).toBe(0)
    expect(r.output).toContain('José año')
    expect(r.output).toContain(join('Mis proyectos', 'José'))
  })

  it('un ejecutable inexistente rechaza con error', async () => {
    const p = makeProject()
    await expect(
      runProcess({ file: join(p.root, 'no-existe'), args: [], cwd: p.root, timeoutMs: 1000, signal: new AbortController().signal }),
    ).rejects.toThrow()
  })
})

describe('shellInvocation', () => {
  it('usa zsh -lc en macOS y PowerShell sin perfil en Windows', () => {
    expect(shellInvocation('ls', 'darwin')).toEqual({ file: '/bin/zsh', args: ['-lc', 'ls'] })
    const win = shellInvocation('node s.js', 'win32')
    expect(win.file).toBe('powershell.exe')
    expect(win.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(win.args[3]).toContain('node s.js')
  })

  it('en Windows el script conserva el código de salida del último programa (powershell -Command solo da 0 o 1)', () => {
    const script = shellInvocation('node s.js', 'win32').args[3]!
    expect(script).toContain('exit $global:LASTEXITCODE')
    // El comando del usuario va en su propia línea, sin mezclarse con el envoltorio.
    expect(script.split('\n')).toContain('node s.js')
  })
})
