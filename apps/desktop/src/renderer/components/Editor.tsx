import { DiffEditor, Editor as MonacoEditor, type OnMount } from '@monaco-editor/react'
import { FileWarning, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { languageFor, monaco } from '@/monaco-setup'
import { useApp } from '@/state/app-store'

const OPTIONS = {
  fontSize: 12,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderLineHighlight: 'line',
  tabSize: 2,
  wordWrap: 'off',
} as const

/** Editor de un archivo del proyecto o diff de un cambio de la sesión. */
export function Editor({ projectId }: { projectId: string }) {
  // Un archivo de otro proyecto no se muestra aquí; su borrador sigue en el store para cuando se vuelva.
  const openFile = useApp((s) => (s.openFile?.projectId === projectId ? s.openFile : null))
  const openDiff = useApp((s) => s.openDiff)
  const error = useApp((s) => s.editorError)

  if (openFile) return <FileEditor />
  if (openDiff) return <DiffView />
  if (error) {
    return (
      <EditorShell path={error.path}>
        <div role="alert" className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <FileWarning className="size-5" />
          {error.message}
        </div>
      </EditorShell>
    )
  }
  return <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-xs">Abre un archivo o un cambio para verlo aquí.</div>
}

function EditorShell({ path, status, actions, children }: { path: string; status?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const closeEditor = useApp((s) => s.closeEditor)
  const guard = useApp((s) => s.guardUnsaved)
  const close = () => guard(closeEditor)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <span className="min-w-0 truncate font-mono" title={path}>
          {path}
        </span>
        {status}
        <span className="ml-auto flex items-center gap-1">
          {actions}
          <Button variant="ghost" size="icon-xs" aria-label="Cerrar el editor" title="Cerrar" onClick={close}>
            <X />
          </Button>
        </span>
      </div>
      {children}
    </div>
  )
}

function FileEditor() {
  const openFile = useApp((s) => s.openFile)!
  const reloads = useApp((s) => s.fileReloads)
  const setDraft = useApp((s) => s.setDraft)
  const save = useApp((s) => s.saveOpenFile)
  const reload = useApp((s) => s.reloadOpenFile)
  const scheme = useColorScheme()
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  // Cmd/Ctrl+S se registra una vez; la referencia apunta siempre a la acción actual.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current(editor.getValue()))
  }

  return (
    <EditorShell
      path={openFile.path}
      status={
        openFile.dirty && (
          <span className="text-warning flex shrink-0 items-center gap-1">
            <span className="bg-warning size-1.5 rounded-full" /> Sin guardar
          </span>
        )
      }
      actions={
        openFile.dirty && (
          <Button variant="ghost" size="xs" onClick={() => editorRef.current && void save(editorRef.current.getValue())}>
            Guardar
          </Button>
        )
      }
    >
      {openFile.diskChanged && (
        <div role="alert" className="bg-warning/10 flex shrink-0 items-center gap-2 border-b px-2 py-1.5 text-xs">
          <span className="flex-1">El archivo cambió en disco.</span>
          <Button variant="outline" size="xs" onClick={() => void reload()}>
            Recargar
          </Button>
        </div>
      )}
      <div data-testid="file-editor" className="min-h-0 flex-1">
        <MonacoEditor
          key={`${openFile.projectId}:${openFile.path}:${reloads}`}
          // El borrador del store: al volver de Ajustes o de otro proyecto, el texto sigue ahí.
          value={openFile.draft}
          language={languageFor(openFile.path)}
          theme={scheme === 'dark' ? 'vs-dark' : 'vs'}
          options={OPTIONS}
          onMount={onMount}
          onChange={(value) => setDraft(value ?? '')}
        />
      </div>
    </EditorShell>
  )
}

function DiffView() {
  const diff = useApp((s) => s.openDiff)!
  const label = diff.original === null ? 'creado' : diff.current === null ? 'eliminado' : 'modificado'
  return (
    <EditorShell path={diff.path} status={<span className="text-muted-foreground shrink-0">· {label} · antes ↔ ahora</span>}>
      <div data-testid="diff-editor" className="min-h-0 flex-1">
        <DiffBody key={`${diff.sessionId}:${diff.path}`} original={diff.original ?? ''} modified={diff.current ?? ''} path={diff.path} />
      </div>
    </EditorShell>
  )
}

function DiffBody({ original, modified, path }: { original: string; modified: string; path: string }) {
  const scheme = useColorScheme()
  const models = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null)
  // @monaco-editor/react libera los modelos antes que el widget de diff y Monaco lanza un error.
  // Se le pide que los conserve y se liberan aquí, cuando el widget ya se ha desmontado.
  useEffect(
    () => () => {
      const pending = models.current
      setTimeout(() => {
        pending?.original.dispose()
        pending?.modified.dispose()
      }, 0)
    },
    [],
  )
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={languageFor(path)}
      theme={scheme === 'dark' ? 'vs-dark' : 'vs'}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(editor) => {
        models.current = editor.getModel()
      }}
      options={{
        ...OPTIONS,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        // El panel es estrecho: se parte la línea en vez de esconder el final de cada lado.
        wordWrap: 'on',
        diffWordWrap: 'on',
        renderOverviewRuler: false,
        lineNumbersMinChars: 3,
        folding: false,
      }}
    />
  )
}
