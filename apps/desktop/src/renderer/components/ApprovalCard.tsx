import type { ApprovalDecision, ApprovalRequest } from '@rev/protocol'
import { commandPrefix } from '@rev/protocol'
import { structuredPatch } from 'diff'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Líneas del diff que se muestran antes de pedir "ver completo". */
export const DIFF_PREVIEW_LINES = 300

type DiffRow = { kind: 'hunk' | 'add' | 'del' | 'ctx'; text: string }

const normalize = (text: string) => text.replace(/\r\n/g, '\n')

export function diffRows(original: string | null, proposed: string): DiffRow[] {
  const patch = structuredPatch('a', 'b', normalize(original ?? ''), normalize(proposed), '', '', { context: 3 })
  const rows: DiffRow[] = []
  for (const hunk of patch.hunks) {
    rows.push({ kind: 'hunk', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` })
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue // "\ No newline at end of file"
      const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'
      rows.push({ kind, text: line.slice(1) })
    }
  }
  return rows
}

export function ApprovalCard({ approval, onDecide }: { approval: ApprovalRequest; onDecide(decision: ApprovalDecision): void }) {
  const [sent, setSent] = useState(false)
  const { preview } = approval
  // La regla exacta que guardaría "Siempre en este proyecto", para que nadie la acepte a ciegas.
  const rule = preview.kind === 'command' ? commandPrefix(preview.command) : null
  const canAlways = preview.kind !== 'command' || rule !== null
  const alwaysHint =
    preview.kind === 'command'
      ? rule
        ? <>«Siempre en este proyecto» permitirá sin preguntar cualquier comando que empiece por <code className="font-mono">{rule}</code>.</>
        : 'Este comando no se puede guardar como regla (es compuesto, usa una opción como segunda palabra o ejecuta código arbitrario): se aprueba cada vez.'
      : approval.toolName === 'write_file'
        ? '«Siempre en este proyecto» permitirá al agente crear y sobrescribir archivos de este proyecto sin preguntar.'
        : '«Siempre en este proyecto» permitirá al agente editar archivos de este proyecto sin preguntar.'
  const title =
    preview.kind === 'command' ? 'El agente quiere ejecutar un comando' : preview.original === null ? 'El agente quiere crear un archivo' : 'El agente quiere editar un archivo'

  const decide = (decision: ApprovalDecision) => {
    setSent(true)
    onDecide(decision)
  }

  return (
    <section aria-label="Aprobación pendiente" className="bg-card my-3 overflow-hidden rounded-lg border shadow-sm">
      <header className="border-b px-3 py-2">
        <p className="font-medium">{title}</p>
        {preview.kind === 'diff' && <p className="text-muted-foreground font-mono text-xs break-all select-text">{preview.path}</p>}
      </header>
      {preview.kind === 'diff' ? (
        <DiffView original={preview.original} proposed={preview.proposed} />
      ) : (
        <div className="px-3 py-2">
          <pre className="bg-muted/60 overflow-x-auto rounded-md border px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap select-text">{preview.command}</pre>
          <p className="text-muted-foreground mt-1.5 text-xs">
            en <span className="font-mono break-all select-text">{preview.cwd}</span>
          </p>
        </div>
      )}
      <p className="text-muted-foreground border-t px-3 pt-2 text-xs">{alwaysHint}</p>
      <footer className="flex flex-wrap gap-2 px-3 py-2">
        <Button size="sm" disabled={sent} onClick={() => decide('once')}>
          Permitir
        </Button>
        {canAlways && (
          <Button size="sm" variant="outline" disabled={sent} onClick={() => decide('always')}>
            Siempre en este proyecto
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive ml-auto" disabled={sent} onClick={() => decide('deny')}>
          Denegar
        </Button>
      </footer>
    </section>
  )
}

function DiffView({ original, proposed }: { original: string | null; proposed: string }) {
  const rows = useMemo(() => diffRows(original, proposed), [original, proposed])
  const [full, setFull] = useState(false)
  const shown = full ? rows : rows.slice(0, DIFF_PREVIEW_LINES)

  if (rows.length === 0) return <p className="text-muted-foreground px-3 py-2 text-xs">Sin cambios en el contenido.</p>
  return (
    <div>
      <div className="max-h-96 overflow-auto py-1 font-mono text-xs leading-relaxed select-text">
        {shown.map((row, i) =>
          row.kind === 'hunk' ? (
            <div key={i} className="text-muted-foreground bg-muted/50 px-3 py-0.5">
              {row.text}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                'flex px-3 whitespace-pre',
                row.kind === 'add' && 'bg-success/12',
                row.kind === 'del' && 'bg-destructive/12',
              )}
            >
              <span aria-hidden className={cn('w-4 shrink-0 select-none', row.kind === 'add' ? 'text-success' : row.kind === 'del' ? 'text-destructive' : 'text-muted-foreground')}>
                {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
              </span>
              <span data-diff={row.kind}>{row.text}</span>
            </div>
          ),
        )}
      </div>
      {!full && rows.length > DIFF_PREVIEW_LINES && (
        <div className="border-t px-3 py-1.5">
          <Button variant="link" size="xs" className="px-0" onClick={() => setFull(true)}>
            Ver completo ({rows.length - DIFF_PREVIEW_LINES} líneas más)
          </Button>
        </div>
      )}
    </div>
  )
}
