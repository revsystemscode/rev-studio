import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DirEntry } from '@rev/protocol'
import { resolveInRoot, toRel } from '../tools/jail'
import { decodeUtf8, looksBinary } from '../tools/text'
import { CoreError } from './errors'

/** Límite para abrir un archivo en el editor de la interfaz. */
export const UI_READ_MAX_BYTES = 2 * 1024 * 1024

export async function listDirectory(root: string, dir: string): Promise<DirEntry[]> {
  const abs = await resolveInRoot(root, dir)
  const rootReal = await resolveInRoot(root, '.')
  const entries = (await readdir(abs, { withFileTypes: true })).filter((e) => e.name !== '.git')
  return entries
    .map((e) => ({ name: e.name, path: toRel(rootReal, path.join(abs, e.name)), isDir: e.isDirectory() }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function readForUi(root: string, p: string): Promise<{ content: string }> {
  const abs = await resolveInRoot(root, p)
  const info = await stat(abs)
  if (info.isDirectory()) throw new CoreError('invalid_params', 'La ruta es una carpeta.')
  if (info.size > UI_READ_MAX_BYTES) throw new CoreError('too_large', 'Archivo demasiado grande para abrirlo (más de 2 MB).')
  const buf = await readFile(abs)
  if (looksBinary(buf)) throw new CoreError('binary', 'Archivo binario; no se puede mostrar.')
  // Abrirlo como UTF-8 y guardarlo después cambiaría sus acentos por "�": no se abre.
  const content = decodeUtf8(buf)
  if (content === null) throw new CoreError('binary', 'El archivo no está en UTF-8; abrirlo aquí y guardarlo lo estropearía.')
  return { content }
}

export async function writeFromUi(root: string, p: string, content: string): Promise<void> {
  const abs = await resolveInRoot(root, p)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content)
}
