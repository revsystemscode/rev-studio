import { ChevronRight, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ToolCallView } from '@/state/session-state'

const MAIN_ARGS = ['path', 'query', 'pattern', 'command'] as const

/** El argumento que mejor resume la llamada: ruta, búsqueda, patrón o comando. */
export function mainArgument(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  for (const key of MAIN_ARGS) if (typeof record[key] === 'string') return record[key] as string
  return ''
}

function summary(call: ToolCallView): string {
  if (call.running) return 'en curso…'
  if (call.output === null) return 'sin resultado'
  const lines = call.output.split('\n')
  const first = lines.find((l) => l.trim() !== '')?.trim() ?? ''
  if (call.isError) return first
  return lines.length > 1 ? `${lines.length} líneas` : first
}

export function ToolLine({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false)
  const arg = mainArgument(call.input)

  return (
    <div className="my-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="hover:bg-accent/60 text-muted-foreground flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs outline-none focus-visible:ring-2"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="text-foreground shrink-0 font-mono font-medium">{call.name}</span>{' '}
        {arg && <span className="text-foreground/80 min-w-0 truncate font-mono">{arg}</span>}{' '}
        <span className={cn('ml-auto max-w-[45%] shrink-0 truncate pl-2', call.isError && 'text-destructive')}>{summary(call)}</span>
        {call.running && <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />}
      </button>
      {open && (
        <div className="mt-1 ml-5 flex flex-col gap-2 text-xs">
          <Block label="Entrada" text={JSON.stringify(call.input, null, 2) ?? ''} />
          {call.output !== null && <Block label="Salida" text={call.output} error={call.isError} />}
        </div>
      )}
    </div>
  )
}

function Block({ label, text, error }: { label: string; text: string; error?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground mb-0.5 font-medium">{label}</p>
      <pre
        className={cn(
          'bg-muted/60 max-h-72 overflow-auto rounded-md border px-2.5 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap select-text',
          error && 'text-destructive',
        )}
      >
        {text}
      </pre>
    </div>
  )
}
