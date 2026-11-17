import type { Session, StoredMessage } from '@rev/protocol'
import { LoaderCircle } from 'lucide-react'
import { Fragment, useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useApp } from '@/state/app-store'
import type { SessionView } from '@/state/session-state'
import { ApprovalCard } from './ApprovalCard'
import { Composer } from './Composer'
import { Markdown } from './Markdown'
import { ModelPicker } from './ModelPicker'
import { ToolLine } from './ToolLine'

/** A partir de esta ocupación el medidor de contexto avisa. */
const CONTEXT_WARNING = 0.8
/** Distancia al final, en píxeles, con la que se sigue considerando que el usuario está abajo. */
const STICK_THRESHOLD = 48

export function Chat({ session }: { session: Session }) {
  const view = useApp((s) => s.sessionViews[session.id])
  const projectName = useApp((s) => s.projects.find((p) => p.id === session.projectId)?.name ?? '')

  return (
    <div className="flex h-full min-w-0 flex-col">
      <ChatHeader session={session} view={view} />
      {view ? (
        <>
          <MessageList session={session} view={view} projectName={projectName} />
          <Composer session={session} />
        </>
      ) : (
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2">
          <LoaderCircle className="size-4 animate-spin" /> Cargando la sesión…
        </div>
      )}
    </div>
  )
}

function ChatHeader({ session, view }: { session: Session; view: SessionView | undefined }) {
  const client = useApp((s) => s.client)
  const providers = useApp((s) => s.providers)
  const setSessionModel = useApp((s) => s.setSessionModel)
  const ratio = view && view.windowTokens ? view.usedTokens / view.windowTokens : null

  return (
    <header className="flex items-start gap-3 border-b px-4 py-2">
      {client && (
        <ModelPicker
          compact
          client={client}
          providers={providers}
          value={{ providerId: session.providerId, model: session.model }}
          disabled={session.turnStatus === 'running'}
          onChange={(choice) => void setSessionModel(session.id, choice)}
        />
      )}
      {ratio !== null && (
        <span
          data-testid="context-meter"
          title={`${view!.usedTokens.toLocaleString('es-ES')} de ${view!.windowTokens!.toLocaleString('es-ES')} tokens`}
          className={cn('ml-auto shrink-0 pt-1.5 text-xs tabular-nums', ratio >= CONTEXT_WARNING ? 'text-warning' : 'text-muted-foreground')}
        >
          contexto {Math.min(100, Math.round(ratio * 100))} %
        </span>
      )}
    </header>
  )
}

function MessageList({ session, view, projectName }: { session: Session; view: SessionView; projectName: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const running = session.turnStatus === 'running'
  const toolRunning = Object.values(view.toolCalls).some((c) => c.running)
  const thinking = running && view.streamingText === '' && !toolRunning && view.approvals.length === 0
  const resolveApproval = useApp((s) => s.resolveApproval)

  // Al cambiar de sesión se empieza abajo.
  useLayoutEffect(() => {
    stick.current = true
  }, [session.id])
  // Autoscroll solo si el usuario estaba al final: no se le arrastra mientras lee más arriba.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4">
        {view.messages.length === 0 && !running && (
          <p className="text-muted-foreground py-10 text-center">
            Describe el cambio que quieres{projectName ? ` en ${projectName}` : ''}. El agente pedirá permiso antes de modificar archivos o ejecutar
            comandos.
          </p>
        )}
        {view.messages.map((message) => (
          <Message key={message.id} message={message} view={view} />
        ))}
        {view.streamingText && (
          <div className="min-w-0">
            <Markdown>{view.streamingText}</Markdown>
          </div>
        )}
        {view.approvals.map((approval) => (
          <ApprovalCard key={approval.id} approval={approval} onDecide={(decision) => void resolveApproval(approval.id, decision)} />
        ))}
        {thinking && (
          <p className="text-muted-foreground flex items-center gap-2 text-xs" role="status">
            <LoaderCircle className="size-3.5 animate-spin" /> Pensando…
          </p>
        )}
      </div>
    </div>
  )
}

function Message({ message, view }: { message: StoredMessage; view: SessionView }) {
  if (message.role === 'tool') return null // sus resultados se ven en la línea de cada llamada
  if (message.role === 'summary') {
    return (
      <div className="text-muted-foreground flex items-center gap-3 py-1 text-xs" role="separator">
        <span className="bg-border h-px flex-1" />
        Contexto resumido
        <span className="bg-border h-px flex-1" />
      </div>
    )
  }
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return <div className="bg-muted ml-auto max-w-[85%] rounded-lg px-3 py-2 break-words whitespace-pre-wrap select-text">{text}</div>
  }
  return (
    <div className="min-w-0">
      {message.parts.map((part, i) => (
        <Fragment key={i}>
          {part.type === 'text' && <Markdown>{part.text}</Markdown>}
          {part.type === 'tool-call' && (
            <ToolLine call={view.toolCalls[part.callId] ?? { callId: part.callId, name: part.name, input: part.input, output: null, isError: false, running: false }} />
          )}
        </Fragment>
      ))}
    </div>
  )
}
