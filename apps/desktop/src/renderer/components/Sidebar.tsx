import type { Project, Session } from '@rev/protocol'
import { ChevronDown, ChevronRight, FolderX, Plus, Settings as SettingsIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useApp } from '@/state/app-store'

type Confirm = { title: string; description: string; action: string; run(): Promise<unknown> }

export function Sidebar() {
  const projects = useApp((s) => s.projects)
  const view = useApp((s) => s.view)
  const addProject = useApp((s) => s.addProject)
  const setView = useApp((s) => s.setView)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  return (
    <nav aria-label="Proyectos" className="bg-sidebar flex h-full flex-col">
      <h2 className="text-muted-foreground px-3 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase">Proyectos</h2>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-1.5 pb-2">
          {projects.length === 0 && (
            <p className="text-muted-foreground px-2 py-3 text-xs leading-relaxed">
              Añade la carpeta de un proyecto para empezar a trabajar en ella.
            </p>
          )}
          {projects.map((project) => (
            <ProjectNode key={project.id} project={project} ask={setConfirm} />
          ))}
        </div>
      </ScrollArea>
      <div className="flex flex-col gap-0.5 border-t p-1.5">
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => void addProject()}>
          + Proyecto
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn('justify-start', view === 'settings' && 'bg-accent')}
          onClick={() => setView(view === 'settings' ? 'main' : 'settings')}
        >
          <SettingsIcon /> Ajustes
        </Button>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const pending = confirm
                setConfirm(null)
                void pending?.run()
              }}
            >
              {confirm?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  )
}

function ProjectNode({ project, ask }: { project: Project; ask(c: Confirm): void }) {
  const sessions = useApp((s) => s.sessionsByProject[project.id])
  const createSession = useApp((s) => s.createSession)
  const removeProject = useApp((s) => s.removeProject)
  const relocateProject = useApp((s) => s.relocateProject)
  const [open, setOpen] = useState(true)

  const askRemove = () =>
    ask({
      title: `¿Quitar «${project.name}»?`,
      description: 'Se borran sus sesiones y reglas guardadas en Rev Studio. La carpeta y sus archivos no se tocan.',
      action: 'Quitar proyecto',
      run: () => removeProject(project.id),
    })
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="mt-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group hover:bg-accent/60 flex h-7 items-center rounded-md pr-1">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 px-1.5 text-left font-medium outline-none"
              aria-expanded={open}
              title={project.path}
              onClick={() => setOpen(!open)}
            >
              {project.available ? (
                <Chevron className="text-muted-foreground size-3.5 shrink-0" />
              ) : (
                <FolderX className="text-muted-foreground size-3.5 shrink-0" />
              )}
              <span className={cn('truncate', !project.available && 'text-muted-foreground')}>{project.name}</span>
            </button>
            {project.available && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-60 group-hover:opacity-100"
                aria-label={`Nueva sesión en ${project.name}`}
                title="Nueva sesión"
                onClick={() => {
                  setOpen(true)
                  void createSession(project.id)
                }}
              >
                <Plus />
              </Button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {project.available && <ContextMenuItem onSelect={() => void createSession(project.id)}>Nueva sesión</ContextMenuItem>}
          <ContextMenuItem onSelect={() => void relocateProject(project.id)}>Reubicar…</ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={askRemove}>
            Quitar proyecto
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {!project.available && (
        <div className="text-muted-foreground pr-1 pb-1 pl-6 text-xs">
          <p>No se encuentra la carpeta.</p>
          <div className="mt-1 flex gap-1">
            <Button variant="outline" size="xs" onClick={() => void relocateProject(project.id)}>
              Reubicar
            </Button>
            <Button variant="ghost" size="xs" onClick={askRemove}>
              Quitar
            </Button>
          </div>
        </div>
      )}

      {project.available && open && (
        <ul className="m-0 list-none p-0">
          {(sessions ?? []).map((session) => (
            <SessionRow key={session.id} session={session} ask={ask} />
          ))}
          {sessions?.length === 0 && <li className="text-muted-foreground py-1 pl-6 text-xs">Sin sesiones</li>}
        </ul>
      )}
    </div>
  )
}

function SessionRow({ session, ask }: { session: Session; ask(c: Confirm): void }) {
  const active = useApp((s) => s.activeSessionId === session.id && s.view === 'main')
  const waiting = useApp((s) => (s.pendingApprovals[session.id]?.length ?? 0) > 0)
  const selectSession = useApp((s) => s.selectSession)
  const deleteSession = useApp((s) => s.deleteSession)
  const running = session.turnStatus === 'running'

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={cn('hover:bg-accent/60 flex h-7 items-center gap-2 rounded-md pr-2 pl-6', active && 'bg-accent hover:bg-accent')}>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left outline-none"
              aria-current={active ? 'true' : undefined}
              onClick={() => selectSession(session.projectId, session.id)}
            >
              {session.title}
            </button>
            {(running || waiting) && (
              <span
                role="status"
                aria-label={waiting ? 'Esperando tu aprobación' : 'Turno en curso'}
                title={waiting ? 'Esperando tu aprobación' : 'Turno en curso'}
                className={cn('size-2 shrink-0 rounded-full', waiting ? 'bg-warning' : 'bg-primary animate-pulse')}
              />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            variant="destructive"
            onSelect={() =>
              ask({
                title: `¿Eliminar «${session.title}»?`,
                description: 'Se borra la conversación y su historial de cambios. Los archivos del proyecto se quedan como están.',
                action: 'Eliminar sesión',
                run: () => deleteSession(session.id),
              })
            }
          >
            Eliminar sesión
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  )
}
