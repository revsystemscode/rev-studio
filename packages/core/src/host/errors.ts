import type { ErrorCode } from '@rev/protocol'
import { ProviderUnreachableError } from '../providers/types'
import { OutsideRootError } from '../tools/jail'
import { isErrno, ToolError } from '../tools/types'

/** Error con un código que la interfaz sabe interpretar. */
export class CoreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CoreError'
  }
}

export const notFound = (what: string) => new CoreError('not_found', `No existe ${what}.`)

export function toWireError(e: unknown): { code: ErrorCode; message: string } {
  const message = e instanceof Error ? e.message : String(e)
  if (e instanceof CoreError) return { code: e.code, message }
  if (e instanceof OutsideRootError) return { code: 'outside_root', message }
  if (e instanceof ProviderUnreachableError) return { code: 'provider_unreachable', message }
  if (e instanceof ToolError) return { code: 'invalid_params', message }
  if (isErrno(e, 'ENOENT')) return { code: 'not_found', message: 'No existe el archivo o la carpeta.' }
  return { code: 'internal', message }
}
