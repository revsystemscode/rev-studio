import type { DirEntry } from '@rev/protocol'
import { ChevronRight, File, Folder, FolderOpen, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { appStore, useApp } from '@/state/app-store'

interface Row {
  entry: DirEntry
  level: number
}

/** Carpetas expandidas por proyecto; se conservan al cambiar de sesión o de pestaña. */
const expandedByProject = new Map<string, Set<string>>()
const hasRoot = (projectId: string) => Boolean(appStore.getState().treeByProject[projectId]?.[''])

export function FileTree({ projectId, changed }: { projectId: string; changed: Set<string> }) {
  const tree = useApp((s) => s.treeByProject[projectId])
  const openFile = useApp((s) => s.openFile)
  const loadDir = useApp((s) => s.loadDir)
  const openPath = useApp((s) => s.openPath)
  const guard = useApp((s) => s.guardUnsaved)
  const open = (path: string) => guard(() => void openPath(projectId, path))
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedByProject.get(projectId) ?? new Set())

  useEffect(() => {
    setExpanded(expandedByProject.get(projectId) ?? new Set())
    if (!hasRoot(projectId)) void loadDir(projectId, '')
  }, [projectId, loadDir])

  // Carpetas que contienen algún archivo cambiado, para marcarlas aunque estén plegadas.
  const changedDirs = useMemo(() => {
    const dirs = new Set<string>()
    for (const p of changed) {
      const parts = p.split('/')
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
    }
    return dirs
  }, [changed])

  // Lista plana con nivel: cada fila es un treeitem hermano, y su nombre accesible es solo el suyo.
  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, level: number) => {
      for (const entry of tree?.[dir] ?? []) {
        out.push({ entry, level })
        if (entry.isDir && expanded.has(entry.path)) walk(entry.path, level + 1)
      }
    }
    walk('', 1)
    return out
  }, [tree, expanded])

  const toggle = (dir: string) => {
    const next = new Set(expanded)
    if (next.has(dir)) next.delete(dir)
    else {
      next.add(dir)
      if (!tree?.[dir]) void loadDir(projectId, dir)
    }
    expandedByProject.set(projectId, next)
    setExpanded(next)
  }

  if (!tree?.['']) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-3 text-xs">
        <LoaderCircle className="size-3.5 animate-spin" /> Cargando archivos…
      </div>
    )
  }
  if (rows.length === 0) return <p className="text-muted-foreground p-3 text-xs">La carpeta está vacía.</p>

  return (
    <div role="tree" aria-label="Archivos" className="py-1 text-[13px]">
      {rows.map(({ entry, level }) => {
        const isOpen = entry.isDir && expanded.has(entry.path)
        const loading = isOpen && !tree[entry.path]
        const selected = !entry.isDir && openFile?.path === entry.path
        const Icon = entry.isDir ? (isOpen ? FolderOpen : Folder) : File
        return (
          <div
            key={entry.path}
            role="treeitem"
            aria-level={level}
            aria-expanded={entry.isDir ? isOpen : undefined}
            aria-selected={selected}
            tabIndex={0}
            title={entry.path}
            onClick={() => (entry.isDir ? toggle(entry.path) : open(entry.path))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (entry.isDir) toggle(entry.path)
                else open(entry.path)
              }
            }}
            style={{ paddingLeft: 6 + (level - 1) * 14 }}
            className={cn(
              'hover:bg-accent/60 flex h-6 cursor-default items-center gap-1.5 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-inset',
              selected && 'bg-accent hover:bg-accent',
            )}
          >
            {entry.isDir ? (
              <ChevronRight className={cn('text-muted-foreground size-3 shrink-0 transition-transform', isOpen && 'rotate-90')} />
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {loading && <LoaderCircle className="text-muted-foreground size-3 animate-spin" />}
            {!entry.isDir && changed.has(entry.path) && (
              <span aria-label="Modificado en esta sesión" title="Modificado en esta sesión" className="text-warning shrink-0 font-mono text-[11px] font-semibold">
                M
              </span>
            )}
            {entry.isDir && changedDirs.has(entry.path) && <span aria-hidden className="bg-warning size-1.5 shrink-0 rounded-full" />}
          </div>
        )
      })}
    </div>
  )
}
