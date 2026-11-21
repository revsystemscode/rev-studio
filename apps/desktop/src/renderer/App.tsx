import { useEffect, useState } from 'react'
import { Chat } from '@/components/Chat'
import { FilesPanel } from '@/components/FilesPanel'
import { FirstRun } from '@/components/FirstRun'
import { Settings } from '@/components/Settings'
import { Sidebar } from '@/components/Sidebar'
import { UpdateBar } from '@/components/UpdateBar'
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
      <div className="flex h-full flex-col">
        <UpdateBar />
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
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
                <Right />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
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

/** Derecha: archivos y cambios del proyecto de la sesión activa. */
function Right() {
  const projectId = useApp((s) => s.activeProjectId)
  const sessionId = useApp((s) => s.activeSessionId)
  const available = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId)?.available ?? false)
  if (!projectId || !sessionId || !available) return <Placeholder>Los archivos y cambios del proyecto aparecerán aquí.</Placeholder>
  return <FilesPanel key={projectId} projectId={projectId} sessionId={sessionId} />
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
