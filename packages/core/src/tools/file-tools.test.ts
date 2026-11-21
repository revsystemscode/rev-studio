import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupProjects, makeProject } from '../testing/project'
import { editFile } from './edit-file'
import { findFiles } from './find-files'
import { OutsideRootError } from './jail'
import { listDir } from './list-dir'
import { readFile } from './read-file'
import { ToolError } from './types'
import { writeFile } from './write-file'

afterEach(cleanupProjects)

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `linea ${i + 1}`).join('\n')

describe('list_dir', () => {
  it('lista carpetas (con barra) antes que archivos', async () => {
    const p = makeProject({ 'b.ts': '', 'a.ts': '', 'src/x.ts': '' })
    expect(await listDir.run({ path: '.' }, p.ctx)).toBe('src/\na.ts\nb.ts')
  })
})

describe('read_file', () => {
  it('numera las líneas y respeta startLine/endLine', async () => {
    const p = makeProject({ 'a.txt': numbered(10) })
    const out = await readFile.run({ path: 'a.txt', startLine: 3, endLine: 4 }, p.ctx)
    expect(out).toBe('     3\tlinea 3\n     4\tlinea 4\n[líneas 3-4 de 10]')
    expect(await readFile.run({ path: 'a.txt' }, p.ctx)).toContain('    10\tlinea 10')
  })

  it('un archivo de 3000 líneas devuelve 2000 e indica el rango', async () => {
    const p = makeProject({ 'grande.txt': numbered(3000) })
    const out = await readFile.run({ path: 'grande.txt' }, p.ctx)
    expect(out).toContain('  2000\tlinea 2000')
    expect(out).not.toContain('linea 2001')
    expect(out.endsWith('[líneas 1-2000 de 3000]')).toBe(true)
  })

  it('corta a 100 000 caracteres e indica hasta qué línea llegó', async () => {
    const p = makeProject({ 'ancho.txt': Array.from({ length: 300 }, () => 'x'.repeat(1000)).join('\n') })
    const out = await readFile.run({ path: 'ancho.txt' }, p.ctx)
    expect(out.length).toBeLessThan(101_000)
    expect(out).toMatch(/\[líneas 1-\d+ de 300\]$/)
  })

  it('respeta el límite de caracteres del contexto (readMaxChars) e indica hasta dónde llegó', async () => {
    const p = makeProject({ 'a.txt': numbered(1000) })
    const out = await readFile.run({ path: 'a.txt' }, { ...p.ctx, readMaxChars: 2000 })
    expect(out.length).toBeLessThan(2200)
    expect(out).toMatch(/\[líneas 1-\d+ de 1000\]$/)
  })

  it('rechaza un archivo binario', async () => {
    const p = makeProject({ 'img.bin': Buffer.from([1, 2, 0, 3]) })
    await expect(readFile.run({ path: 'img.bin' }, p.ctx)).rejects.toBeInstanceOf(ToolError)
  })

  it('un archivo inexistente da un ToolError legible', async () => {
    const p = makeProject()
    await expect(readFile.run({ path: 'nada.ts' }, p.ctx)).rejects.toThrow(/No existe/)
  })

  it('no marca la salida para recorte genérico', () => {
    expect(readFile.truncateOutput).toBe(false)
    expect(listDir.truncateOutput).toBe(true)
  })
})

describe('find_files', () => {
  it('respeta .gitignore y no lista node_modules ignorado', async () => {
    const p = makeProject({
      '.gitignore': 'node_modules\n',
      'src/a.ts': '',
      'src/b.js': '',
      'node_modules/dep/index.ts': '',
    })
    expect(await findFiles.run({ pattern: '**/*.ts' }, p.ctx)).toBe('src/a.ts')
  })

  it('sin coincidencias lo dice sin error', async () => {
    const p = makeProject({ 'a.ts': '' })
    expect(await findFiles.run({ pattern: '*.py' }, p.ctx)).toBe('Sin resultados.')
  })

  it('limita a 500 resultados e indica que hay más', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 520; i++) files[`f${String(i).padStart(3, '0')}.txt`] = ''
    const p = makeProject(files)
    const out = (await findFiles.run({ pattern: '*.txt' }, p.ctx)).split('\n')
    expect(out).toHaveLength(501)
    expect(out[500]).toBe('[… 20 resultados más; usa un patrón más específico …]')
  })

  it('funciona con espacios y caracteres no ASCII en la raíz', async () => {
    const p = makeProject({ 'señal.ts': '' }, 'Mis proyectos/José')
    expect(await findFiles.run({ pattern: '*.ts' }, p.ctx)).toBe('señal.ts')
  })
})

describe('edit_file', () => {
  it('reemplaza una coincidencia única, captura la instantánea y avisa del cambio', async () => {
    const p = makeProject({ 'src/a.ts': 'const ok = false\n' })
    await editFile.run({ path: 'src/a.ts', oldText: 'false', newText: 'true' }, p.ctx)
    expect(readFileSync(join(p.root, 'src/a.ts'), 'utf8')).toBe('const ok = true\n')
    expect(p.changed).toEqual(['src/a.ts'])
    expect(await p.ctx.snapshots.diff('src/a.ts')).toEqual({ original: 'const ok = false\n', current: 'const ok = true\n' })
  })

  it('falla sin tocar el archivo con 0 coincidencias y con 2', async () => {
    const p = makeProject({ 'a.ts': 'x x' })
    await expect(editFile.run({ path: 'a.ts', oldText: 'y', newText: 'z' }, p.ctx)).rejects.toThrow(/no aparece/)
    await expect(editFile.run({ path: 'a.ts', oldText: 'x', newText: 'z' }, p.ctx)).rejects.toThrow(/2 veces/)
    expect(readFileSync(join(p.root, 'a.ts'), 'utf8')).toBe('x x')
    expect(p.changed).toEqual([])
    expect(await p.ctx.snapshots.list()).toEqual([])
  })

  it('en un archivo CRLF coincide con oldText en \\n y conserva solo CRLF', async () => {
    const p = makeProject({ 'win.ts': 'uno\r\ndos\r\ntres\r\n' })
    await editFile.run({ path: 'win.ts', oldText: 'uno\ndos', newText: 'uno\nDOS\nextra' }, p.ctx)
    expect(readFileSync(join(p.root, 'win.ts'), 'utf8')).toBe('uno\r\nDOS\r\nextra\r\ntres\r\n')
  })

  it('en un archivo LF, un oldText con CRLF también coincide y no introduce CR', async () => {
    const p = makeProject({ 'unix.ts': 'uno\ndos\n' })
    await editFile.run({ path: 'unix.ts', oldText: 'uno\r\ndos', newText: 'a\r\nb' }, p.ctx)
    expect(readFileSync(join(p.root, 'unix.ts'), 'utf8')).toBe('a\nb\n')
  })

  it('preview devuelve el diff sin escribir', async () => {
    const p = makeProject({ 'a.ts': 'false' })
    expect(await editFile.preview!({ path: 'a.ts', oldText: 'false', newText: 'true' }, p.ctx)).toEqual({
      kind: 'diff',
      path: 'a.ts',
      original: 'false',
      proposed: 'true',
    })
    expect(readFileSync(join(p.root, 'a.ts'), 'utf8')).toBe('false')
  })
})

describe('write_file', () => {
  it('crea carpetas intermedias, captura la instantánea y avisa', async () => {
    const p = makeProject()
    await writeFile.run({ path: 'nueva/sub/b.ts', content: 'hola' }, p.ctx)
    expect(readFileSync(join(p.root, 'nueva/sub/b.ts'), 'utf8')).toBe('hola')
    expect(p.changed).toEqual(['nueva/sub/b.ts'])
    expect(await p.ctx.snapshots.list()).toEqual([{ path: 'nueva/sub/b.ts', status: 'created' }])
  })

  it('preview.original es null si no existía y el contenido previo si existía', async () => {
    const p = makeProject({ 'a.ts': 'viejo' })
    expect(await writeFile.preview!({ path: 'b.ts', content: 'n' }, p.ctx)).toMatchObject({ original: null, proposed: 'n' })
    expect(await writeFile.preview!({ path: 'a.ts', content: 'n' }, p.ctx)).toMatchObject({ original: 'viejo' })
    expect(existsSync(join(p.root, 'b.ts'))).toBe(false)
  })
})

describe('archivos que no son UTF-8', () => {
  // "Año: café" en Latin-1 / Windows-1252: no es binario, pero tampoco UTF-8 válido.
  const latin1 = Buffer.from([0x41, 0xf1, 0x6f, 0x3a, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a])

  it('edit_file se niega a editarlo y no lo toca', async () => {
    const p = makeProject({ 'viejo.txt': latin1 })
    await expect(editFile.preview!({ path: 'viejo.txt', oldText: 'caf', newText: 'te' }, p.ctx)).rejects.toThrow(/UTF-8/)
    await expect(editFile.run({ path: 'viejo.txt', oldText: 'caf', newText: 'te' }, p.ctx)).rejects.toThrow(/UTF-8/)
    expect(readFileSync(join(p.root, 'viejo.txt'))).toEqual(latin1)
    expect(p.changed).toEqual([])
  })

  it('write_file se niega a sobrescribir un archivo binario o que no es UTF-8, sin tocarlo', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
    const p = makeProject({ 'logo.png': png, 'viejo.txt': latin1 })
    await expect(writeFile.preview!({ path: 'logo.png', content: 'x' }, p.ctx)).rejects.toThrow(/binario/)
    await expect(writeFile.run({ path: 'logo.png', content: 'x' }, p.ctx)).rejects.toThrow(/binario/)
    await expect(writeFile.run({ path: 'viejo.txt', content: 'x' }, p.ctx)).rejects.toThrow(/UTF-8/)
    expect(readFileSync(join(p.root, 'logo.png'))).toEqual(png)
    expect(readFileSync(join(p.root, 'viejo.txt'))).toEqual(latin1)
  })
})

describe('jaula', () => {
  it.each([
    ['list_dir', () => listDir, { path: '..' }],
    ['read_file', () => readFile, { path: '../x.txt' }],
    ['edit_file', () => editFile, { path: '../x.txt', oldText: 'a', newText: 'b' }],
    ['write_file', () => writeFile, { path: '../x.txt', content: 'x' }],
  ] as const)('%s rechaza rutas fuera de la raíz', async (_name, tool, input) => {
    const p = makeProject()
    await expect(tool().run(input as never, p.ctx)).rejects.toBeInstanceOf(OutsideRootError)
  })

  it('find_files rechaza patrones que salen de la raíz', async () => {
    const p = makeProject()
    await expect(findFiles.run({ pattern: '../**/*.ts' }, p.ctx)).rejects.toBeInstanceOf(ToolError)
  })
})
