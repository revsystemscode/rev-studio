import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/state/app-store'

/** Modelo que se sugiere descargar a quien empieza con Ollama. */
export const SUGGESTED_MODEL = 'qwen3:14b'
const OLLAMA_DOWNLOAD = 'https://ollama.com/download'

export function FirstRun() {
  const refreshProviders = useApp((s) => s.refreshProviders)
  const setView = useApp((s) => s.setView)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)

  const recheck = async () => {
    setChecking(true)
    await refreshProviders()
    setChecking(false)
    setChecked(true)
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-xl font-semibold">Conecta un modelo para empezar</h1>
        <p className="text-muted-foreground mt-1">
          Rev Studio no ha encontrado ningún proveedor de modelos en marcha. Elige uno de estos dos caminos.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="bg-card flex flex-col rounded-lg border p-4">
            <h2 className="font-medium">Modelos en este equipo</h2>
            <p className="text-muted-foreground mt-1 flex-1">Instala Ollama, ábrelo y descarga un modelo que admita herramientas:</p>
            <code className="bg-muted mt-3 block rounded-md px-2 py-1.5 font-mono text-xs">ollama pull {SUGGESTED_MODEL}</code>
            <Button className="mt-3 self-start" onClick={() => void window.rev.openExternal(OLLAMA_DOWNLOAD)}>
              Instalar Ollama
            </Button>
          </section>
          <section className="bg-card flex flex-col rounded-lg border p-4">
            <h2 className="font-medium">Un servidor que ya tienes</h2>
            <p className="text-muted-foreground mt-1 flex-1">
              Usa LM Studio o cualquier servicio compatible con la API de OpenAI indicando su URL y, si hace falta, su clave.
            </p>
            <Button variant="outline" className="mt-3 self-start" onClick={() => setView('settings')}>
              Configurar un endpoint
            </Button>
          </section>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <Button variant="secondary" disabled={checking} onClick={() => void recheck()}>
            Volver a comprobar
          </Button>
          <span role="status" className="text-muted-foreground text-xs">
            {checking ? 'Comprobando…' : checked ? 'Sigue sin haber ningún proveedor accesible.' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
