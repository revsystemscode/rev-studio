import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

/** Aviso discreto de versión nueva; se comprueba una vez al arrancar. */
export function UpdateBar() {
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    window.rev.checkForUpdate().then(setUpdate, () => {})
  }, [])

  if (!update || hidden) return null
  return (
    <div role="status" className="bg-primary/10 flex h-9 shrink-0 items-center gap-3 border-b px-4 text-xs">
      <span className="flex-1">Hay una versión nueva (v{update.version}).</span>
      <Button size="xs" onClick={() => void window.rev.openExternal(update.url)}>
        <Download /> Descargar
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Ocultar aviso" title="Ocultar" onClick={() => setHidden(true)}>
        <X />
      </Button>
    </div>
  )
}
