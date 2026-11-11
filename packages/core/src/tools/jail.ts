import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { isErrno, ToolError } from './types'

export class OutsideRootError extends ToolError {
  constructor(p: string) {
    super(`La ruta "${p}" está fuera de la carpeta del proyecto.`)
    this.name = 'OutsideRootError'
  }
}

/**
 * Devuelve la ruta absoluta real de `p` si queda dentro de `root`; si no, lanza OutsideRootError.
 * Resuelve enlaces simbólicos del ancestro existente más profundo, de modo que tampoco se puede
 * escapar creando un archivo nuevo dentro de una carpeta enlazada hacia fuera.
 */
export async function resolveInRoot(root: string, p: string): Promise<string> {
  const rootReal = await realpath(root)
  const target = path.resolve(rootReal, p)

  let existing = target
  const rest: string[] = []
  let real: string
  for (;;) {
    try {
      real = await realpath(existing)
      break
    } catch (e) {
      if (!isErrno(e, 'ENOENT') && !isErrno(e, 'ENOTDIR')) throw e
      // Existe como enlace pero su destino no: escribir ahí seguiría el enlace.
      if (await lstat(existing).then(() => true, () => false)) throw new OutsideRootError(p)
      const parent = path.dirname(existing)
      if (parent === existing) throw new OutsideRootError(p)
      rest.unshift(path.basename(existing))
      existing = parent
    }
  }

  const full = path.join(real, ...rest)
  const rel = path.relative(rootReal, full)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new OutsideRootError(p)
  return full
}

/** Ruta relativa a la raíz con `/` en todas las plataformas. `abs` debe venir de resolveInRoot. */
export function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}
