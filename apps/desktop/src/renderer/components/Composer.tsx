import type { Session } from '@rev/protocol'
import { ArrowUp, RotateCcw, Square } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/state/app-store'

export function Composer({ session }: { session: Session }) {
  const sendMessage = useApp((s) => s.sendMessage)
  const stopTurn = useApp((s) => s.stopTurn)
  const retryTurn = useApp((s) => s.retryTurn)
  const [text, setText] = useState('')
  const running = session.turnStatus === 'running'
  const canSend = !running && text.trim() !== ''

  const send = async () => {
    if (!canSend) return
    const message = text
    setText('')
    // Si el core rechaza el mensaje, se devuelve al cuadro para no perderlo.
    if (!(await sendMessage(session.id, message))) setText((current) => current || message)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="border-t px-4 pt-2 pb-3">
      {(session.turnStatus === 'interrupted' || session.turnStatus === 'failed') && (
        <div
          role={session.turnStatus === 'failed' ? 'alert' : 'status'}
          className="mb-2 flex items-start gap-3 rounded-md border px-3 py-2 text-xs"
        >
          <p className={session.turnStatus === 'failed' ? 'text-destructive min-w-0 flex-1 break-words select-text' : 'text-muted-foreground flex-1'}>
            {session.turnStatus === 'failed' ? (session.turnError ?? 'El turno falló.') : 'El turno se interrumpió.'}
          </p>
          <Button size="xs" variant="outline" onClick={() => void retryTurn(session.id)}>
            <RotateCcw /> Reintentar
          </Button>
        </div>
      )}
      <div className="bg-background focus-within:ring-ring/40 flex items-end gap-2 rounded-lg border px-3 py-2 focus-within:ring-2">
        <textarea
          aria-label="Mensaje"
          placeholder={running ? 'El agente está trabajando…' : 'Pide un cambio… (Mayús+Intro para nueva línea)'}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="placeholder:text-muted-foreground max-h-60 min-h-6 flex-1 resize-none bg-transparent py-0.5 leading-6 outline-none [field-sizing:content]"
        />
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => void stopTurn(session.id)}>
            <Square className="fill-current" /> Detener
          </Button>
        ) : (
          <Button size="icon-sm" aria-label="Enviar" title="Enviar" disabled={!canSend} onClick={() => void send()}>
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  )
}
