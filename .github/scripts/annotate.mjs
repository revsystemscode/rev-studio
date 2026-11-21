// Ejecuta un comando y, si falla, publica el final de su salida como anotación de GitHub Actions:
// las anotaciones se leen sin iniciar sesión, los logs completos no.
// Uso: node .github/scripts/annotate.mjs <comando...>
import { spawn } from 'node:child_process'

const TAIL_LINES = 150
const command = process.argv.slice(2).join(' ')
const lines = []
const child = spawn(command, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] })
const collect = (stream, out) =>
  stream.on('data', (chunk) => {
    out.write(chunk)
    lines.push(...chunk.toString().split(/\r?\n/))
    if (lines.length > TAIL_LINES * 4) lines.splice(0, lines.length - TAIL_LINES * 2)
  })
collect(child.stdout, process.stdout)
collect(child.stderr, process.stderr)
child.on('close', (code) => {
  if (code !== 0) {
    // Sin códigos de color; los saltos de línea se codifican como exige el formato de anotaciones.
    const tail = lines
      .slice(-TAIL_LINES)
      .join('\n')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/%/g, '%25')
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A')
    const title = `${command} (${process.platform})`.replace(/%/g, '%25').replace(/:/g, '%3A').replace(/,/g, '%2C')
    console.log(`::error title=${title}::${tail}`)
  }
  process.exit(code ?? 1)
})
