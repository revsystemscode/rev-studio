import { describe, expect, it } from 'vitest'
import { CoreEventSchema, methods, RequestSchema, ResponseSchema } from './index'

describe('protocol', () => {
  it('acepta una petición válida de turn.send', () => {
    expect(methods['turn.send'].params.safeParse({ sessionId: 's1', text: 'hola' }).success).toBe(true)
  })
  it('rechaza turn.send sin texto', () => {
    expect(methods['turn.send'].params.safeParse({ sessionId: 's1' }).success).toBe(false)
  })
  it('rechaza un evento con tipo desconocido', () => {
    expect(CoreEventSchema.safeParse({ type: 'nope' }).success).toBe(false)
  })
  it('acepta un evento text.delta válido', () => {
    expect(CoreEventSchema.safeParse({ type: 'text.delta', sessionId: 's', delta: 'x' }).success).toBe(true)
  })
  it('rechaza una decisión de aprobación inválida', () => {
    expect(methods['approval.resolve'].params.safeParse({ approvalId: 'a', decision: 'maybe' }).success).toBe(false)
  })
  it('toda entrada de methods tiene params y result', () => {
    for (const m of Object.values(methods)) {
      expect(m.params).toBeDefined()
      expect(m.result).toBeDefined()
    }
  })
  it('valida sobres de petición y de respuesta con error', () => {
    expect(RequestSchema.safeParse({ id: 1, method: 'projects.list', params: {} }).success).toBe(true)
    expect(ResponseSchema.safeParse({ id: 1, error: { code: 'not_found', message: 'x' } }).success).toBe(true)
    expect(ResponseSchema.safeParse({ id: 1, error: { code: 'weird', message: 'x' } }).success).toBe(false)
  })
})

describe('isPlainCommand', () => {
  it('solo los comandos simples pueden coincidir con una regla guardada', async () => {
    const { isPlainCommand } = await import('./index')
    const unsafe = [
      'a && b', 'a | b', 'a; b', 'a > f', 'echo `x`', 'echo $(x)', 'echo ${x}', 'a\nb', 'a\rb', 'a & b',
      // zsh: sustitución de proceso y calificadores de glob ejecutan código.
      'npm test =(touch pwned)', 'npm test *(e:"touch pwned":)',
      // PowerShell: paréntesis, subexpresiones y bloques se evalúan en modo argumento.
      'npm test (Remove-Item x)', 'npm test @(1)', 'npm test { x }', 'npm test $env:X',
      'ls *.ts', 'ls [ab]', 'ls a?',
    ]
    for (const c of unsafe) expect(isPlainCommand(c), c).toBe(false)
    for (const c of ['npm test', 'git status --short', 'npm run build -- --mode=prod', "git commit -m 'Añade ñandú'", 'pnpm --filter @rev/core test', 'pytest tests/unit -k login'])
      expect(isPlainCommand(c), c).toBe(true)
  })
})

describe('commandPrefix', () => {
  it('toma las dos primeras palabras, o una si no hay más', async () => {
    const { commandPrefix } = await import('./index')
    expect(commandPrefix('npm test -- --watch')).toBe('npm test')
    expect(commandPrefix('  npm   test  ')).toBe('npm test')
    expect(commandPrefix('ls')).toBe('ls')
  })

  it('no ofrece regla si el comando no es simple, si la segunda palabra es una opción o si ejecuta código arbitrario', async () => {
    const { commandPrefix } = await import('./index')
    const none = [
      'a && b', '   ', 'npm test (x)',
      // "rm -rf dist" guardaría "rm -rf", que también borraría cualquier otra cosa.
      'rm -rf dist', 'git -c core.x=1 status', 'ls -la src',
      // Intérpretes y lanzadores: la regla permitiría cualquier programa.
      "node -e 'x'", 'node script.js', 'python3 -c x', 'bash run.sh', 'sh -c x', 'pwsh -File x.ps1', 'npx -y cosa', 'npx cosa',
      'pnpm dlx cosa', 'pnpm exec cosa', 'npm exec cosa', 'yarn dlx cosa', 'bun x cosa', 'env FOO=1 npm test', 'sudo npm test', 'xargs rm',
    ]
    for (const c of none) expect(commandPrefix(c), c).toBeNull()
    expect(commandPrefix('git push origin main')).toBe('git push')
  })
})
