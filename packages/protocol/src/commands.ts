// Caracteres con los que una shell (zsh o PowerShell) puede ejecutar algo más que el comando visible:
// encadenar, redirigir, sustituir o expandir. Lo comparten el core (reglas guardadas) y la interfaz.
const CHAIN_PATTERN = /[&|;<>`\n\r]|\$\(|\$\{/

/** Un comando encadenado nunca se guarda como "permitir siempre". */
export function isChained(command: string): boolean {
  return CHAIN_PATTERN.test(command)
}
