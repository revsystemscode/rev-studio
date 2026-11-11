import type { ApprovalPreview } from '@rev/protocol'
import type { z } from 'zod'
import type { SnapshotStore } from '../snapshots/store'

export interface ToolContext {
  /** Carpeta del proyecto: toda ruta de archivo debe quedar dentro. */
  root: string
  sessionId: string
  signal: AbortSignal
  rgPath: string
  snapshots: SnapshotStore
  /** Ruta relativa a la raíz, con `/`. */
  onFileChanged(relPath: string): void
}

export interface ToolDef<I = any> {
  name: string
  description: string
  schema: z.ZodType<I>
  /** `read` nunca pide permiso; `edit` y `command` sí. */
  kind: 'read' | 'edit' | 'command'
  /** Si la salida pasa por el recorte genérico antes de ir al modelo. */
  truncateOutput: boolean
  preview?(input: I, ctx: ToolContext): Promise<ApprovalPreview>
  run(input: I, ctx: ToolContext): Promise<string>
}

/** Error cuyo mensaje se devuelve tal cual al modelo como resultado de la herramienta. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export function isErrno(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && (e as NodeJS.ErrnoException).code === code
}
