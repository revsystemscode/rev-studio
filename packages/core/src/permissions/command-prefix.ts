// Caracteres con los que una shell (zsh o PowerShell) puede ejecutar algo más que el comando visible:
// encadenar, redirigir, sustituir o expandir.
const CHAIN_PATTERN = /[&|;<>`\n\r]|\$\(|\$\{/

export function isChained(command: string): boolean {
  return CHAIN_PATTERN.test(command)
}

export function words(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

/** Prefijo que se guarda con "permitir siempre": las dos primeras palabras. Null si no es seguro guardarlo. */
export function commandPrefix(command: string): string | null {
  if (isChained(command)) return null
  const w = words(command)
  if (w.length === 0) return null
  return w.slice(0, 2).join(' ')
}
