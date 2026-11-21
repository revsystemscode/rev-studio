import { afterEach, describe, expect, it } from 'vitest'
import { cleanupProjects, makeProject } from '../testing/project'
import { search } from './search'
import { ToolError } from './types'

afterEach(cleanupProjects)

describe('search', () => {
  it('devuelve ruta:línea:texto', async () => {
    const p = makeProject({ 'src/auth.ts': 'const a = 1\nfunction login() {}\n', 'b.ts': 'nada' })
    expect(await search.run({ query: 'login' }, p.ctx)).toBe('src/auth.ts:2:function login() {}')
  })

  it('sin coincidencias no es un error', async () => {
    const p = makeProject({ 'a.ts': 'x' })
    expect(await search.run({ query: 'inexistente' }, p.ctx)).toBe('Sin resultados.')
  })

  it('respeta .gitignore y el filtro glob, e ignora mayúsculas salvo caseSensitive', async () => {
    const p = makeProject({
      '.gitignore': 'node_modules\n',
      'node_modules/x/i.ts': 'Login',
      'a.ts': 'Login',
      'a.md': 'Login',
    })
    expect(await search.run({ query: 'login' }, p.ctx)).toBe('a.md:1:Login\na.ts:1:Login')
    expect(await search.run({ query: 'login', glob: '*.ts' }, p.ctx)).toBe('a.ts:1:Login')
    expect(await search.run({ query: 'login', caseSensitive: true }, p.ctx)).toBe('Sin resultados.')
  })

  it('una expresión regular inválida da un ToolError', async () => {
    const p = makeProject({ 'a.ts': 'x' })
    await expect(search.run({ query: '(' }, p.ctx)).rejects.toBeInstanceOf(ToolError)
  })

  it('funciona con espacios y caracteres no ASCII en la raíz', async () => {
    const p = makeProject({ 'señal.ts': 'año' }, 'Mis proyectos/José')
    expect(await search.run({ query: 'año' }, p.ctx)).toBe('señal.ts:1:año')
  })
})
