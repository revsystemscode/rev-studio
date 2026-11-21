/** Recorta conservando el principio y el final, que es donde suelen estar el contexto y el error. */
export function truncateOutput(text: string, maxLines = 400, maxChars = 20_000): string {
  let out = text
  const lines = out.split('\n')
  if (lines.length > maxLines) {
    const half = Math.floor(maxLines / 2)
    const omitted = lines.length - half * 2
    out = [...lines.slice(0, half), `[… ${omitted} líneas omitidas …]`, ...lines.slice(-half)].join('\n')
  }
  if (out.length > maxChars) {
    const half = Math.floor(maxChars / 2)
    const omitted = out.length - half * 2
    out = `${out.slice(0, half)}\n[… ${omitted} caracteres omitidos …]\n${out.slice(-half)}`
  }
  return out
}
