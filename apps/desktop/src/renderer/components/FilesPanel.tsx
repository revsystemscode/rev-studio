import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApp } from '@/state/app-store'
import { ChangesList } from './ChangesList'
import { Editor } from './Editor'
import { FileTree } from './FileTree'

const EMPTY: never[] = []

/** Derecha: árbol de archivos o cambios de la sesión arriba, editor abajo. */
export function FilesPanel({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const changes = useApp((s) => s.changesBySession[sessionId] ?? EMPTY)
  const [tab, setTab] = useState('files')
  const discardPrompt = useApp((s) => s.discardPrompt)
  const answerDiscard = useApp((s) => s.answerDiscard)
  const changed = useMemo(() => new Set(changes.filter((c) => c.status !== 'deleted').map((c) => c.path)), [changes])

  return (
    <section aria-label="Archivos del proyecto" className="h-full">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel id="files-top" defaultSize="45%" minSize={120}>
          <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col gap-0">
            <div className="border-b px-2 py-1.5">
              <TabsList className="h-8">
                <TabsTrigger value="files" className="text-xs">
                  Archivos
                </TabsTrigger>
                <TabsTrigger value="changes" className="text-xs">
                  Cambios ({changes.length})
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="files" className="min-h-0 flex-1 overflow-auto">
              <FileTree projectId={projectId} changed={changed} />
            </TabsContent>
            <TabsContent value="changes" className="min-h-0 flex-1 overflow-auto">
              <ChangesList sessionId={sessionId} />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="editor" minSize={120}>
          <Editor projectId={projectId} />
        </ResizablePanel>
      </ResizablePanelGroup>
      <Dialog open={discardPrompt !== null} onOpenChange={(open) => !open && answerDiscard(false)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>¿Descartar los cambios sin guardar?</DialogTitle>
            <DialogDescription>
              {discardPrompt?.path} tiene cambios que no se han guardado. Si continúas, se pierden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => answerDiscard(false)}>
              Seguir editando
            </Button>
            <Button variant="destructive" onClick={() => answerDiscard(true)}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
