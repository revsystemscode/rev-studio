import type { ChangedFile } from '@rev/protocol'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useApp } from '@/state/app-store'

const STATUS: Record<ChangedFile['status'], { label: string; className: string }> = {
  modified: { label: 'modificado', className: 'text-warning' },
  created: { label: 'creado', className: 'text-success' },
  deleted: { label: 'eliminado', className: 'text-destructive' },
}

export function ChangesList({ sessionId }: { sessionId: string }) {
  const changes = useApp((s) => s.changesBySession[sessionId])
  const openDiff = useApp((s) => s.openDiff)
  const showDiff = useApp((s) => s.showDiff)
  const guard = useApp((s) => s.guardUnsaved)
  const revertFile = useApp((s) => s.revertFile)
  const [confirm, setConfirm] = useState<ChangedFile | null>(null)

  if (!changes) return <p className="text-muted-foreground p-3 text-xs">Cargando cambios…</p>
  if (changes.length === 0) {
    return <p className="text-muted-foreground p-3 text-xs leading-relaxed">El agente no ha cambiado ningún archivo en esta sesión.</p>
  }

  return (
    <>
      <ul className="m-0 list-none py-1">
        {changes.map((change) => {
          const selected = openDiff?.sessionId === sessionId && openDiff.path === change.path
          const status = STATUS[change.status]
          return (
            <li key={change.path} className={cn('group hover:bg-accent/60 flex h-7 items-center gap-2 pr-1 pl-2', selected && 'bg-accent hover:bg-accent')}>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-mono text-xs outline-none"
                title={change.path}
                onClick={() => guard(() => void showDiff(sessionId, change.path))}
              >
                {change.path}
              </button>
              <span className={cn('shrink-0 text-[11px]', status.className)}>{status.label}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-60 group-hover:opacity-100"
                aria-label={`Revertir ${change.path}`}
                title="Revertir"
                onClick={() => setConfirm(change)}
              >
                <RotateCcw />
              </Button>
            </li>
          )
        })}
      </ul>
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>¿Revertir {confirm?.path}?</DialogTitle>
            <DialogDescription>
              {confirm?.status === 'created'
                ? 'El archivo lo creó el agente en esta sesión: se borrará del disco.'
                : 'Vuelve al contenido que tenía antes de que el agente lo cambiara. Se pierde lo que se haya escrito después.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = confirm
                setConfirm(null)
                if (target) void revertFile(sessionId, target.path)
              }}
            >
              Revertir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
