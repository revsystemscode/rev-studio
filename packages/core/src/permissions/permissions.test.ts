import { afterEach, describe, expect, it } from 'vitest'
import { permissionsRepo } from '../db/repos/permissions'
import { projectsRepo } from '../db/repos/projects'
import { cleanupProjects, makeProject } from '../testing/project'
import { editFile } from '../tools/edit-file'
import { readFile } from '../tools/read-file'
import { runCommand } from '../tools/run-command'
import { search } from '../tools/search'
import { writeFile } from '../tools/write-file'
import { PermissionService } from './service'

afterEach(cleanupProjects)

function setup() {
  const p = makeProject()
  const repo = permissionsRepo(p.db)
  return { p, repo, service: new PermissionService(repo) }
}
const cmd = (command: string) => ({ command })
const edit = { path: 'a.ts', oldText: 'a', newText: 'b' }

describe('PermissionService', () => {
  it('las herramientas de lectura siempre se permiten', () => {
    const { p, service } = setup()
    expect(service.check(p.projectId, readFile, { path: 'a' })).toBe('allow')
    expect(service.check(p.projectId, search, { query: 'a' })).toBe('allow')
  })

  it('edit_file pregunta hasta remember; después se permite y write_file sigue preguntando', () => {
    const { p, service } = setup()
    expect(service.check(p.projectId, editFile, edit)).toBe('ask')
    service.remember(p.projectId, editFile, edit)
    expect(service.check(p.projectId, editFile, { ...edit, path: 'otro.ts' })).toBe('allow')
    expect(service.check(p.projectId, writeFile, { path: 'a.ts', content: '' })).toBe('ask')
  })

  it('tras recordar "npm test" se permiten sus variantes con más argumentos', () => {
    const { p, service } = setup()
    expect(service.check(p.projectId, runCommand, cmd('npm test'))).toBe('ask')
    service.remember(p.projectId, runCommand, cmd('npm test -- --watch'))
    expect(service.check(p.projectId, runCommand, cmd('npm test'))).toBe('allow')
    expect(service.check(p.projectId, runCommand, cmd('npm  test -- x'))).toBe('allow')
  })

  it('un prefijo no cubre otras palabras parecidas ni otros subcomandos', () => {
    const { p, service } = setup()
    service.remember(p.projectId, runCommand, cmd('npm test'))
    expect(service.check(p.projectId, runCommand, cmd('npm testx'))).toBe('ask')
    expect(service.check(p.projectId, runCommand, cmd('npm run build'))).toBe('ask')
    expect(service.check(p.projectId, runCommand, cmd('npm'))).toBe('ask')
  })

  it('un comando encadenado pregunta aunque exista la regla de su prefijo', () => {
    const { p, service } = setup()
    service.remember(p.projectId, runCommand, cmd('npm test'))
    expect(service.check(p.projectId, runCommand, cmd('npm test && rm -rf .'))).toBe('ask')
    expect(service.check(p.projectId, runCommand, cmd('npm test; rm -rf .'))).toBe('ask')
    expect(service.check(p.projectId, runCommand, cmd('npm test $(rm -rf .)'))).toBe('ask')
  })

  it('una regla guardada no cubre sustituciones de zsh ni expresiones de PowerShell', () => {
    const { p, service } = setup()
    service.remember(p.projectId, runCommand, cmd('npm test'))
    for (const bypass of ['npm test =(touch pwned)', 'npm test *(e:"touch pwned":)', 'npm test (Remove-Item -Recurse x)', 'npm test @(x)'])
      expect(service.check(p.projectId, runCommand, cmd(bypass)), bypass).toBe('ask')
  })

  it('remember no guarda reglas que permitirían mucho más de lo que se vio', () => {
    const { p, repo, service } = setup()
    service.remember(p.projectId, runCommand, cmd('rm -rf dist'))
    service.remember(p.projectId, runCommand, cmd("node -e 'console.log(1)'"))
    service.remember(p.projectId, runCommand, cmd('pnpm dlx cosa'))
    expect(repo.list(p.projectId)).toEqual([])
  })

  it('remember de un comando encadenado no crea regla', () => {
    const { p, repo, service } = setup()
    service.remember(p.projectId, runCommand, cmd('npm test && echo ok'))
    expect(repo.list(p.projectId)).toEqual([])
  })

  it('las reglas de un proyecto no aplican a otro', () => {
    const { p, service } = setup()
    const other = projectsRepo(p.db).add('otro', '/tmp/otro')
    service.remember(p.projectId, runCommand, cmd('npm test'))
    service.remember(p.projectId, editFile, edit)
    expect(service.check(other.id, runCommand, cmd('npm test'))).toBe('ask')
    expect(service.check(other.id, editFile, edit)).toBe('ask')
  })

  it('una regla de comando no autoriza ediciones ni al revés', () => {
    const { p, repo, service } = setup()
    repo.add(p.projectId, 'run_command', '*')
    expect(service.check(p.projectId, editFile, edit)).toBe('ask')
    expect(service.check(p.projectId, runCommand, cmd('rm -rf .'))).toBe('ask')
  })
})
