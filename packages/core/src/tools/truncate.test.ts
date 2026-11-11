import { describe, expect, it } from 'vitest'
import { truncateOutput } from './truncate'

describe('truncateOutput', () => {
  it('no toca textos dentro de los límites', () => {
    const text = Array.from({ length: 400 }, (_, i) => `l${i}`).join('\n')
    expect(truncateOutput(text)).toBe(text)
  })

  it('1000 líneas → conserva 200 + 200 e indica 600 omitidas', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `linea ${i + 1}`)
    const out = truncateOutput(lines.join('\n')).split('\n')
    expect(out).toHaveLength(401)
    expect(out[0]).toBe('linea 1')
    expect(out[199]).toBe('linea 200')
    expect(out[200]).toBe('[… 600 líneas omitidas …]')
    expect(out[201]).toBe('linea 801')
    expect(out[400]).toBe('linea 1000')
  })

  it('una sola línea de 50 000 caracteres queda en 20 000 más el marcador', () => {
    const out = truncateOutput('a'.repeat(25_000) + 'b'.repeat(25_000))
    expect(out).toContain('[… 30000 caracteres omitidos …]')
    expect(out.replace(/\n?\[….*…\]\n?/, '')).toHaveLength(20_000)
    expect(out.startsWith('a'.repeat(10_000))).toBe(true)
    expect(out.endsWith('b'.repeat(10_000))).toBe(true)
  })
})
