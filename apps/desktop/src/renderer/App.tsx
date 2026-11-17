import { useEffect, useState } from 'react'
import { Chat } from '@/components/Chat'
import { FirstRun } from '@/components/FirstRun'
import { Settings } from '@/components/Settings'
import { Sidebar } from '@/components/Sidebar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { TooltipProvider } from '@/components/ui/tooltip'
import { connectCore } from './connect'
import { appStore, useApp } from './state/app-store'

export function App() {
  const [connections, setConnections] = useState(0)
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const noProvider = useApp((s) => s.ready && !s.providers.some((p) => p.reachable))

  useEffect(
    () =>
      connectCore((client) => {
        setConnections((n) => n + 1)
        const { init, applyEvent } = appStore.getState()
        client.onEvent(applyEvent)
        void init(client)
      }),
    [],
  )

  return (
    <TooltipProvider>
      {/* Estado de la conexión con el core, para las pruebas de extremo a extremo. */}
      <span hidden data-testid="core-status">
        {ready ? 'conectado' : 'conectando'}
      </span>
      <span hidden data-testid="core-connections">
        {connections}
      </span>
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel id="sidebar" defaultSize="20%" minSize={180} maxSize="35%">
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle />
        {!ready ? (
          <ResizablePanel id="loading">
            <Placeholder>Conectando…</Placeholder>
          </ResizablePanel>
        ) : view === 'settings' ? (
          <ResizablePanel id="settings">
            <Settings />
          </ResizablePanel>
        ) : noProvider ? (
          <ResizablePanel id="first-run">
            <FirstRun />
          </ResizablePanel>
        ) : (
          <>
            <ResizablePanel id="chat" minSize={320}>
              <Center />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="files" defaultSize="34%" minSize={240}>
              <Placeholder>Los archivos y cambios del proyecto aparecerán aquí.</Placeholder>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <Notice />
    </TooltipProvider>
  )
}

/** Centro: el chat de la sesión activa o una indicación de qué hacer. */
function Center() {
  const session = useApp((s) =>
    s.activeProjectId && s.activeSessionId ? s.sessionsByProject[s.activeProjectId]?.find((x) => x.id === s.activeSessionId) : undefined,
  )
  const hasProjects = useApp((s) => s.projects.length > 0)
  if (!session) {
    return <Placeholder>{hasProjects ? 'Elige una sesión o crea una nueva en la barra lateral.' : 'Añade un proyecto para empezar.'}</Placeholder>
  }
  return <Chat key={session.id} session={session} />
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center">{children}</div>
}

function Notice() {
  const notice = useApp((s) => s.notice)
  const dismiss = useApp((s) => s.dismissNotice)
  if (!notice) return null
  return (
    <div role="alert" className="bg-popover text-popover-foreground fixed right-4 bottom-4 z-50 flex max-w-md items-start gap-3 rounded-lg border p-3 shadow-lg">
      <p className="min-w-0 flex-1 break-words select-text">{notice}</p>
      <button type="button" className="text-muted-foreground hover:text-foreground shrink-0 text-xs outline-none" onClick={dismiss}>
        Cerrar
      </button>
    </div>
  )
}
