import type { ProviderStatus } from '@rev/protocol'
import { useEffect, useState } from 'react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CoreClient } from '@/client'

export interface ModelChoice {
  providerId: string
  model: string
}

/** Por debajo de esta ventana el agente pierde contexto con facilidad. */
export const SMALL_WINDOW_TOKENS = 32_000

const NO_TOOLS = 'Este modelo no admite herramientas y no sirve para el modo Code.'
const smallWindow = (n: number) => `Ventana de contexto pequeña (${n.toLocaleString('es-ES')} tokens); el agente puede perder contexto.`

interface Group {
  provider: ProviderStatus['config']
  models: string[]
}

export function ModelPicker(props: {
  client: CoreClient
  providers: ProviderStatus[]
  value: ModelChoice | null
  onChange(choice: ModelChoice): void
  id?: string
  disabled?: boolean
  /** Variante para la cabecera del chat: más baja y estrecha. */
  compact?: boolean
}) {
  const { client, providers, value, onChange } = props
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'warning'; text: string } | null>(null)

  useEffect(() => {
    let stale = false
    void Promise.all(
      providers
        .filter((p) => p.reachable)
        .map(async (p) => ({ provider: p.config, models: await client.call('providers.models', { providerId: p.config.id }).catch(() => []) })),
    ).then((loaded) => {
      if (!stale) setGroups(loaded.filter((g) => g.models.length > 0))
    })
    return () => {
      stale = true
    }
  }, [client, providers])

  const options = (groups ?? []).flatMap((g) => g.models.map((model) => ({ providerId: g.provider.id, model })))
  const selected = value ? options.findIndex((o) => o.providerId === value.providerId && o.model === value.model) : -1

  const choose = async (index: string) => {
    const choice = options[Number(index)]
    if (!choice) return
    setMessage(null)
    setChecking(true)
    try {
      const caps = await client.call('providers.capabilities', choice)
      if (caps.tools === 'no') {
        setMessage({ kind: 'error', text: NO_TOOLS })
        return
      }
      if (caps.contextWindow !== null && caps.contextWindow < SMALL_WINDOW_TOKENS) {
        setMessage({ kind: 'warning', text: smallWindow(caps.contextWindow) })
      }
      onChange(choice)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setChecking(false)
    }
  }

  const placeholder =
    groups === null ? 'Cargando modelos…' : options.length === 0 ? 'No hay modelos disponibles' : (value?.model ?? 'Elige un modelo')
  let offset = 0

  return (
    <div className="flex flex-col gap-1.5">
      <Select value={selected >= 0 ? String(selected) : ''} onValueChange={(v) => void choose(v)} disabled={props.disabled || checking || options.length === 0}>
        <SelectTrigger id={props.id} size={props.compact ? 'sm' : 'default'} className={props.compact ? 'max-w-64 min-w-40' : 'w-full max-w-sm'} aria-label="Modelo">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {(groups ?? []).map((group) => {
            const start = offset
            offset += group.models.length
            return (
              <SelectGroup key={group.provider.id}>
                <SelectLabel>{group.provider.name}</SelectLabel>
                {group.models.map((model, i) => (
                  <SelectItem key={model} value={String(start + i)}>
                    {model}
                  </SelectItem>
                ))}
              </SelectGroup>
            )
          })}
        </SelectContent>
      </Select>
      {checking && <p className="text-muted-foreground text-xs">Comprobando el modelo…</p>}
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-destructive text-xs' : 'text-warning text-xs'}>
          {message.text}
        </p>
      )}
    </div>
  )
}
