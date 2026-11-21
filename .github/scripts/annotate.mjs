// Ejecuta un comando y, si falla, publica como anotaciones de GitHub Actions las líneas de fallo y
// el final de su salida: las anotaciones se leen sin iniciar sesión, los logs completos no.
// Uso: node .github/scripts/annotate.mjs <comando...>
import { spawn } from 'node:child_process'

const TAIL_LINES = 120
const MAX_LINES = 50_000
const FAILURE = /\bFAIL\b|×|✘|Error:|Expected:|Received:|Timeout|Test Files|Tests /
const command = process.argv.slice(2).join(' ')
const lines = []
const child = spawn(command, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] })
const collect = (stream, out) =>
  stream.on('data', (chunk) => {
    out.write(chunk)
    lines.push(...chunk.toString().split(/\r?\n/))
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
  })
collect(child.stdout, process.stdout)
collect(child.stderr, process.stderr)

const clean = (text) => text.replace(/\x1b\[[0-9;]*m/g, '')
const data = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const property = (text) => data(text).replace(/:/g, '%3A').replace(/,/g, '%2C')
const annotate = (title, body) => console.log(`::error title=${property(`${title} (${process.platform})`)}::${data(body)}`)

child.on('close', (code) => {
  if (code !== 0) {
    const all = lines.map(clean)
    const failures = all.filter((l) => FAILURE.test(l) && !l.startsWith('::'))
    annotate(`Fallos de ${command}`, [...new Set(failures)].slice(0, 400).join('\n'))
    annotate(`Final de ${command}`, all.slice(-TAIL_LINES).join('\n'))
  }
  process.exit(code ?? 1)
})
