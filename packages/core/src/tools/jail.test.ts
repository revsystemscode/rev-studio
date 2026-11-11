import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupProjects, makeProject } from '../testing/project'
import { OutsideRootError, resolveInRoot, toRel } from './jail'

const extra: string[] = []
afterEach(() => {
  cleanupProjects()
  for (const d of extra.splice(0)) rmSync(d, { recursive: true, force: true })
})

function outsideDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'rev-outside-')))
  extra.push(d)
  writeFileSync(join(d, 'secreto.txt'), 'secreto')
  return d
}

/** En Windows sin privilegios, crear enlaces simbólicos falla con EPERM: se omite la prueba. */
function trySymlink(target: string, link: string, type: 'dir' | 'file'): boolean {
  try {
    symlinkSync(target, link, type)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return false
    throw e
  }
}

describe('resolveInRoot', () => {
  it('acepta una ruta relativa y devuelve la absoluta dentro de la raíz', async () => {
    const p = makeProject({ 'src/a.ts': 'x' })
    expect(await resolveInRoot(p.root, 'src/a.ts')).toBe(join(p.root, 'src', 'a.ts'))
    expect(await resolveInRoot(p.root, '.')).toBe(p.root)
  })

  it('rechaza ".." que sale de la raíz', async () => {
    const p = makeProject()
    await expect(resolveInRoot(p.root, '../fuera.txt')).rejects.toBeInstanceOf(OutsideRootError)
    await expect(resolveInRoot(p.root, 'src/../../fuera.txt')).rejects.toBeInstanceOf(OutsideRootError)
  })

  it('rechaza una ruta absoluta fuera de la raíz y acepta una absoluta dentro', async () => {
    const p = makeProject({ 'a.ts': 'x' })
    const out = outsideDir()
    await expect(resolveInRoot(p.root, join(out, 'secreto.txt'))).rejects.toBeInstanceOf(OutsideRootError)
    expect(await resolveInRoot(p.root, join(p.root, 'a.ts'))).toBe(join(p.root, 'a.ts'))
  })

  it('rechaza una carpeta hermana cuyo nombre empieza igual que la raíz', async () => {
    const p = makeProject()
    mkdirSync(`${p.root}-otro`)
    writeFileSync(join(`${p.root}-otro`, 'x.txt'), 'x')
    await expect(resolveInRoot(p.root, `${p.root}-otro/x.txt`)).rejects.toBeInstanceOf(OutsideRootError)
  })

  it('rechaza un symlink dentro de la raíz que apunta fuera', async (t) => {
    const p = makeProject()
    const out = outsideDir()
    if (!trySymlink(join(out, 'secreto.txt'), join(p.root, 'enlace.txt'), 'file')) return t.skip()
    await expect(resolveInRoot(p.root, 'enlace.txt')).rejects.toBeInstanceOf(OutsideRootError)
  })

  it('rechaza un archivo nuevo dentro de una carpeta-symlink que apunta fuera', async (t) => {
    const p = makeProject()
    const out = outsideDir()
    if (!trySymlink(out, join(p.root, 'carpeta'), 'dir')) return t.skip()
    await expect(resolveInRoot(p.root, 'carpeta/nuevo.txt')).rejects.toBeInstanceOf(OutsideRootError)
  })

  it('rechaza un symlink colgante (su destino aún no existe)', async (t) => {
    const p = makeProject()
    const out = outsideDir()
    if (!trySymlink(join(out, 'aun-no-existe.txt'), join(p.root, 'colgante.txt'), 'file')) return t.skip()
    await expect(resolveInRoot(p.root, 'colgante.txt')).rejects.toBeInstanceOf(OutsideRootError)
  })

  it('acepta un archivo nuevo en una carpeta que aún no existe', async () => {
    const p = makeProject()
    expect(await resolveInRoot(p.root, 'nueva/sub/b.ts')).toBe(join(p.root, 'nueva', 'sub', 'b.ts'))
  })

  it('funciona con espacios y caracteres no ASCII en la raíz', async () => {
    const p = makeProject({ 'año nuevo.txt': 'x' }, 'Mis proyectos/José')
    expect(await resolveInRoot(p.root, 'año nuevo.txt')).toBe(join(p.root, 'año nuevo.txt'))
    await expect(resolveInRoot(p.root, '../../fuera')).rejects.toBeInstanceOf(OutsideRootError)
  })

  it.skipIf(process.platform !== 'win32')('en Windows rechaza otra unidad e ignora mayúsculas en la raíz', async () => {
    const p = makeProject({ 'a.ts': 'x' })
    const other = p.root.startsWith('D:') ? 'C:\\x' : 'D:\\x'
    await expect(resolveInRoot(p.root, other)).rejects.toBeInstanceOf(OutsideRootError)
    expect(await resolveInRoot(p.root.toLowerCase(), 'a.ts')).toBeTruthy()
    expect(await resolveInRoot(p.root.toUpperCase(), join(p.root.toLowerCase(), 'a.ts'))).toBeTruthy()
  })

  it('toRel devuelve la ruta relativa con barras normales', async () => {
    const p = makeProject()
    expect(toRel(p.root, join(p.root, 'src', 'a.ts'))).toBe('src/a.ts')
  })
})
