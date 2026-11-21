import type { PermissionRule, Project, ProviderConfig, ProviderType } from '@rev/protocol'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CoreClient } from '@/client'
import { cn } from '@/lib/utils'
import { useApp } from '@/state/app-store'
import { ModelPicker } from './ModelPicker'

const TYPES: { type: Exclude<ProviderType, 'fake'>; label: string; url: string }[] = [
  { type: 'ollama', label: 'Ollama', url: 'http://localhost:11434' },
  { type: 'lmstudio', label: 'LM Studio', url: 'http://localhost:1234/v1' },
  { type: 'openai-compatible', label: 'Compatible con OpenAI', url: '' },
]
const typeLabel = (type: ProviderType) => TYPES.find((t) => t.type === type)?.label ?? 'Pruebas'
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Settings() {
  const client = useApp((s) => s.client)
  const setView = useApp((s) => s.setView)

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
        <header className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Volver" title="Volver" onClick={() => setView('main')}>
            <ArrowLeft />
          </Button>
          <h1 className="text-lg font-semibold">Ajustes</h1>
        </header>
        {client && (
          <>
            <Providers client={client} />
            <DefaultModel client={client} />
            <Permissions client={client} />
          </>
        )}
      </div>
    </ScrollArea>
  )
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-medium">{title}</h2>
          {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Providers({ client }: { client: CoreClient }) {
  const providers = useApp((s) => s.providers)
  const refreshProviders = useApp((s) => s.refreshProviders)
  const [editing, setEditing] = useState<ProviderConfig | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (id: string) => {
    setError(null)
    try {
      await client.call('providers.remove', { id })
    } catch (e) {
      setError(errorText(e))
    }
    await refreshProviders()
  }

  return (
    <Section
      title="Proveedores de modelos"
      hint="Servidores a los que Rev Studio pide los modelos."
      action={
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refreshProviders()}>
            Volver a comprobar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            Añadir proveedor
          </Button>
        </div>
      }
    >
      <ul className="m-0 list-none divide-y rounded-lg border p-0">
        {providers.map(({ config, reachable }) => (
          <li key={config.id} data-testid="provider-row" className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {config.name}
                {typeLabel(config.type) !== config.name && <span className="text-muted-foreground font-normal"> · {typeLabel(config.type)}</span>}
              </p>
              <p className="text-muted-foreground truncate font-mono text-xs">
                {config.baseUrl}
                {config.hasKey && ' · clave guardada'}
                {config.contextSize && ` · contexto ${config.contextSize.toLocaleString('es-ES')}`}
              </p>
            </div>
            <span className={cn('flex shrink-0 items-center gap-1.5 text-xs', reachable ? 'text-success' : 'text-muted-foreground')}>
              <span className={cn('size-1.5 rounded-full', reachable ? 'bg-success' : 'bg-muted-foreground/60')} />
              {reachable ? 'Conectado' : 'Sin conexión'}
            </span>
            {config.type !== 'fake' && (
              <>
                <Button variant="outline" size="xs" onClick={() => setEditing(config)}>
                  Editar
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Eliminar ${config.name}`} title="Eliminar" onClick={() => void remove(config.id)}>
                  <Trash2 />
                </Button>
              </>
            )}
          </li>
        ))}
        {providers.length === 0 && <li className="text-muted-foreground px-3 py-3 text-xs">No hay proveedores. Añade uno para empezar.</li>}
      </ul>
      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing !== null && (
            <ProviderForm
              key={editing === 'new' ? 'new' : editing.id}
              client={client}
              provider={editing === 'new' ? null : editing}
              onDone={() => {
                setEditing(null)
                void refreshProviders()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Section>
  )
}

function ProviderForm({ client, provider, onDone }: { client: CoreClient; provider: ProviderConfig | null; onDone(): void }) {
  const initialType = provider && provider.type !== 'fake' ? provider.type : 'ollama'
  const [type, setType] = useState<Exclude<ProviderType, 'fake'>>(initialType)
  const [name, setName] = useState(provider?.name ?? 'Ollama')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? TYPES[0]!.url)
  const [key, setKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [contextSize, setContextSize] = useState(provider?.contextSize ? String(provider.contextSize) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changeType = (next: Exclude<ProviderType, 'fake'>) => {
    const from = TYPES.find((t) => t.type === type)!
    const to = TYPES.find((t) => t.type === next)!
    // Solo se sustituyen los valores que el usuario no ha tocado.
    if (name.trim() === '' || name === from.label) setName(to.label)
    if (baseUrl.trim() === '' || baseUrl === from.url) setBaseUrl(to.url)
    setType(next)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const size = contextSize.trim() === '' ? null : Number(contextSize)
    if (size !== null && (!Number.isInteger(size) || size <= 0)) {
      setError('El tamaño de contexto debe ser un número entero de tokens mayor que cero.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // La clave sale del formulario ya cifrada; sin clave nueva se conserva la guardada.
      const keyCipher = key ? await window.rev.encryptSecret(key) : clearKey ? null : undefined
      await client.call('providers.save', { id: provider?.id, type, name: name.trim(), baseUrl: baseUrl.trim(), keyCipher, contextSize: size })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }

  const keyPlaceholder = provider?.hasKey && !clearKey ? 'Clave guardada' : 'Sin clave'

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{provider ? `Editar ${provider.name}` : 'Añadir proveedor'}</DialogTitle>
        <DialogDescription>La clave se guarda cifrada con el llavero del sistema y nunca se vuelve a mostrar.</DialogDescription>
      </DialogHeader>
      <Field label="Tipo" htmlFor="provider-type">
        <Select value={type} onValueChange={(v) => changeType(v as Exclude<ProviderType, 'fake'>)}>
          <SelectTrigger id="provider-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t.type} value={t.type}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Nombre" htmlFor="provider-name">
        <Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="URL" htmlFor="provider-url">
        <Input
          id="provider-url"
          className="font-mono"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://servidor/v1"
          spellCheck={false}
          required
        />
      </Field>
      <Field label="Clave de API" htmlFor="provider-key">
        <Input
          id="provider-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={keyPlaceholder}
        />
        {provider?.hasKey && !key && (
          <Button type="button" variant="link" size="xs" className="self-start px-0" onClick={() => setClearKey(!clearKey)}>
            {clearKey ? 'Conservar la clave guardada' : 'Quitar la clave guardada'}
          </Button>
        )}
      </Field>
      <Field label="Tamaño de contexto (tokens)" htmlFor="provider-context" hint="Vacío: se usa el que indique el servidor.">
        <Input
          id="provider-context"
          inputMode="numeric"
          value={contextSize}
          onChange={(e) => setContextSize(e.target.value)}
          placeholder="Automático"
        />
      </Field>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={saving}>
          Guardar
        </Button>
      </DialogFooter>
    </form>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}

function DefaultModel({ client }: { client: CoreClient }) {
  const providers = useApp((s) => s.providers)
  const settings = useApp((s) => s.settings)
  const setDefaultModel = useApp((s) => s.setDefaultModel)
  const value = settings.defaultProviderId && settings.defaultModel ? { providerId: settings.defaultProviderId, model: settings.defaultModel } : null

  return (
    <Section title="Modelo por defecto" hint="El que usan las sesiones nuevas. Sin elegir, se usa el primero disponible.">
      <ModelPicker client={client} providers={providers} value={value} onChange={(choice) => void setDefaultModel(choice)} />
    </Section>
  )
}

function Permissions({ client }: { client: CoreClient }) {
  const projects = useApp((s) => s.projects)
  const [rules, setRules] = useState<Record<string, PermissionRule[]>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const lists = await Promise.all(projects.map((p) => client.call('permissions.list', { projectId: p.id })))
      setRules(Object.fromEntries(projects.map((p, i) => [p.id, lists[i] ?? []])))
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [client, projects])
  useEffect(() => void load(), [load])

  const remove = async (id: string) => {
    try {
      await client.call('permissions.remove', { id })
    } catch (e) {
      setError(errorText(e))
    }
    await load()
  }
  const withRules = projects.filter((p) => (rules[p.id]?.length ?? 0) > 0)

  return (
    <Section title="Permisos guardados" hint="Acciones que elegiste permitir siempre en cada proyecto.">
      {withRules.length === 0 && <p className="text-muted-foreground rounded-lg border px-3 py-3 text-xs">No hay reglas guardadas.</p>}
      {withRules.map((project) => (
        <ProjectRules key={project.id} project={project} rules={rules[project.id] ?? []} onRemove={(id) => void remove(id)} />
      ))}
      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}
    </Section>
  )
}

function ProjectRules({ project, rules, onRemove }: { project: Project; rules: PermissionRule[]; onRemove(id: string): void }) {
  return (
    <div className="mb-3">
      <h3 className="text-muted-foreground mb-1 text-xs font-medium">{project.name}</h3>
      <ul className="m-0 list-none divide-y rounded-lg border p-0">
        {rules.map((rule) => (
          <li key={rule.id} className="flex items-center gap-3 px-3 py-2">
            <span className="shrink-0 font-mono text-xs">{rule.toolName}</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">{rule.pattern}</span>
            <Button variant="ghost" size="icon-xs" aria-label={`Borrar regla ${rule.toolName} ${rule.pattern}`} title="Borrar regla" onClick={() => onRemove(rule.id)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
