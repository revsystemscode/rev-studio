/** Repositorio público donde se publican las versiones. */
export const RELEASES_REPO = 'revsystemscode/rev-studio'

const TIMEOUT_MS = 10_000

function parse(version: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Verdadero si `latest` es una versión semver posterior a `current`. Tolera el prefijo "v". */
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!
  return false
}

/**
 * Consulta la última release publicada. Cualquier fallo (sin red, 404, límite de peticiones,
 * respuesta inesperada) devuelve null: el aviso de versión nunca molesta al usuario con errores.
 */
export async function checkForUpdate(current: string, fetchImpl: typeof fetch = fetch): Promise<{ version: string; url: string } | null> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof body.tag_name !== 'string' || typeof body.html_url !== 'string') return null
    // La barra abre este enlace en el navegador: solo se aceptan páginas de GitHub.
    if (!body.html_url.startsWith('https://github.com/')) return null
    if (!isNewer(body.tag_name, current)) return null
    return { version: body.tag_name.replace(/^v/, ''), url: body.html_url }
  } catch {
    return null
  }
}
