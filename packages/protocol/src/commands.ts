// Qué comandos pueden cubrirse con una regla de "permitir siempre". Lo comparten el core (que decide)
// y la interfaz (que enseña la regla antes de guardarla).

/**
 * Caracteres de un comando "simple": palabras, rutas, opciones y comillas. Todo lo demás puede hacer
 * que zsh o PowerShell ejecuten algo distinto de lo visible: encadenar (`;` `&` `|`), redirigir,
 * sustituir (`$(…)`, `=(…)`), calificadores de glob (`*(e:…:)`), expresiones de PowerShell (`(…)`,
 * `@(…)`, `{…}`, `$env:X`) o globs. Es una lista blanca: lo que no está aquí, se pregunta siempre.
 */
const PLAIN = /^[\p{L}\p{N} \t\-_./:=@+,%~^'"]*$/u

/** Programas que ejecutan cualquier código que se les pase: una regla sobre ellos lo permitiría todo. */
const CODE_RUNNERS = new Set([
  'node', 'nodejs', 'deno', 'bun', 'bunx', 'npx', 'tsx', 'ts-node',
  'python', 'python3', 'py', 'ruby', 'perl', 'php', 'lua',
  'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'osascript',
  'env', 'sudo', 'doas', 'xargs', 'eval', 'exec', 'source', '.', 'nohup', 'time', 'watch', 'start',
])
/** Subcomandos que descargan o ejecutan un programa cualquiera. */
const CODE_RUNNER_PREFIXES = new Set(['npm exec', 'npm x', 'pnpm dlx', 'pnpm exec', 'yarn dlx', 'yarn exec', 'bun x'])

export function words(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

/** Verdadero si el comando solo tiene palabras, rutas, opciones y comillas: nada que la shell evalúe. */
export function isPlainCommand(command: string): boolean {
  return PLAIN.test(command)
}

/**
 * Regla que guarda "Siempre en este proyecto": las dos primeras palabras (p. ej. `npm test`).
 * Null si no se puede guardar sin permitir mucho más de lo que el usuario vio: comandos no simples,
 * una opción como segunda palabra (`rm -rf dist` daría `rm -rf`) o programas que ejecutan cualquier código.
 */
export function commandPrefix(command: string): string | null {
  if (!isPlainCommand(command)) return null
  const w = words(command)
  if (w.length === 0) return null
  const first = w[0]!.toLowerCase()
  if (CODE_RUNNERS.has(first)) return null
  if (w[1]?.startsWith('-')) return null
  const prefix = w.slice(0, 2).join(' ')
  if (CODE_RUNNER_PREFIXES.has(prefix.toLowerCase())) return null
  return prefix
}
