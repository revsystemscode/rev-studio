import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupProjects, makeProject } from '../testing/project'

afterEach(cleanupProjects)

describe('SnapshotStore', () => {
  it('captureBeforeWrite dos veces conserva el primer original', async () => {
    const p = makeProject({ 'a.ts': 'uno' })
    const abs = join(p.root, 'a.ts')
    await p.ctx.snapshots.captureBeforeWrite(abs)
    writeFileSync(abs, 'dos')
    await p.ctx.snapshots.captureBeforeWrite(abs)
    writeFileSync(abs, 'tres')
    expect(await p.ctx.snapshots.diff('a.ts')).toEqual({ original: 'uno', current: 'tres' })
  })

  it('list clasifica modified, created y deleted, y omite archivos idénticos al original', async () => {
    const p = makeProject({ 'mod.ts': 'a', 'del.ts': 'b', 'igual.ts': 'c' })
    for (const f of ['mod.ts', 'del.ts', 'igual.ts', 'sub/nuevo.ts']) {
      await p.ctx.snapshots.captureBeforeWrite(join(p.root, f))
    }
    writeFileSync(join(p.root, 'mod.ts'), 'a2')
    rmSync(join(p.root, 'del.ts'))
    p.write('sub/nuevo.ts', 'n')
    expect(await p.ctx.snapshots.list()).toEqual([
      { path: 'del.ts', status: 'deleted' },
      { path: 'mod.ts', status: 'modified' },
      { path: 'sub/nuevo.ts', status: 'created' },
    ])
  })

  it('revert restaura el contenido y elimina la instantánea', async () => {
    const p = makeProject({ 'a.ts': 'original' })
    const abs = join(p.root, 'a.ts')
    await p.ctx.snapshots.captureBeforeWrite(abs)
    writeFileSync(abs, 'cambiado')
    await p.ctx.snapshots.revert('a.ts')
    expect(readFileSync(abs, 'utf8')).toBe('original')
    expect(await p.ctx.snapshots.list()).toEqual([])
  })

  it('revert de un archivo creado lo borra; revert de uno borrado lo recrea', async () => {
    const p = makeProject({ 'viejo.ts': 'v' })
    await p.ctx.snapshots.captureBeforeWrite(join(p.root, 'nuevo.ts'))
    p.write('nuevo.ts', 'n')
    await p.ctx.snapshots.captureBeforeWrite(join(p.root, 'viejo.ts'))
    rmSync(join(p.root, 'viejo.ts'))
    await p.ctx.snapshots.revert('nuevo.ts')
    await p.ctx.snapshots.revert('viejo.ts')
    expect(existsSync(join(p.root, 'nuevo.ts'))).toBe(false)
    expect(readFileSync(join(p.root, 'viejo.ts'), 'utf8')).toBe('v')
  })

  it('revert y diff rechazan rutas sin instantánea o fuera de la raíz', async () => {
    const p = makeProject({ 'a.ts': 'x' })
    await expect(p.ctx.snapshots.revert('a.ts')).rejects.toThrow()
    await expect(p.ctx.snapshots.diff('../fuera.ts')).rejects.toThrow()
  })
})
