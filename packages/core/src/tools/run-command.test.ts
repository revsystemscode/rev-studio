import { afterEach, describe, expect, it } from 'vitest'
import { cleanupProjects, makeProject } from '../testing/project'
import { allTools, getTool, toolSpecs } from './registry'
import { effectiveTimeoutSeconds, runCommand } from './run-command'

afterEach(cleanupProjects)

describe('run_command', () => {
  it('devuelve la salida y el código de salida', async () => {
    const p = makeProject({ 's.js': "console.log('hola')" })
    expect(await runCommand.run({ command: 'node s.js' }, p.ctx)).toBe('hola\n[código de salida: 0]')
  })

  it('un código distinto de 0 no lanza', async () => {
    const p = makeProject({ 's.js': "console.error('mal'); process.exit(2)" })
    expect(await runCommand.run({ command: 'node s.js' }, p.ctx)).toBe('mal\n[código de salida: 2]')
  })

  it('informa del tiempo agotado con la salida parcial', async () => {
    const p = makeProject({ 's.js': "console.log('parcial'); setTimeout(() => {}, 60000)" })
    expect(await runCommand.run({ command: 'node s.js', timeoutSeconds: 1 }, p.ctx)).toBe(
      'parcial\n[tiempo agotado tras 1 s]',
    )
  })

  it('informa de la cancelación', async () => {
    const p = makeProject({ 's.js': 'setTimeout(() => {}, 60000)' })
    setTimeout(() => p.abort.abort(), 500)
    expect(await runCommand.run({ command: 'node s.js' }, p.ctx)).toBe('[cancelado]')
  })

  it('el tiempo máximo es 120 s por defecto y se limita a 600 s', () => {
    expect(effectiveTimeoutSeconds(undefined)).toBe(120)
    expect(effectiveTimeoutSeconds(30)).toBe(30)
    expect(effectiveTimeoutSeconds(9999)).toBe(600)
  })

  it('preview devuelve el comando completo y la carpeta', async () => {
    const p = makeProject()
    expect(await runCommand.preview!({ command: 'npm test && echo ok' }, p.ctx)).toEqual({
      kind: 'command',
      command: 'npm test && echo ok',
      cwd: p.root,
    })
  })
})

describe('registry', () => {
  it('expone las siete herramientas con su tipo', () => {
    expect(Object.fromEntries(allTools.map((t) => [t.name, t.kind]))).toEqual({
      list_dir: 'read',
      read_file: 'read',
      find_files: 'read',
      search: 'read',
      edit_file: 'edit',
      write_file: 'edit',
      run_command: 'command',
    })
    expect(getTool('search')?.name).toBe('search')
    expect(getTool('nope')).toBeUndefined()
  })

  it('toolSpecs genera JSON Schema de objeto con los campos requeridos', () => {
    const spec = toolSpecs().find((s) => s.name === 'edit_file')!
    expect(spec.parameters).toMatchObject({
      type: 'object',
      required: ['path', 'oldText', 'newText'],
      properties: { path: { type: 'string' } },
    })
    expect(spec.description.length).toBeGreaterThan(10)
  })
})
