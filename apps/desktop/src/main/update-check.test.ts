import { describe, expect, it } from 'vitest'
import { checkForUpdate, isNewer, RELEASES_REPO } from './update-check'

type FetchLike = typeof fetch
const respond = (status: number, body: unknown): FetchLike =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as FetchLike

describe('update-check', () => {
  it('isNewer compara semver y tolera el prefijo v', () => {
    expect(isNewer('v0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1.10', '0.1.9')).toBe(true)
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
    expect(isNewer('v1.0.0', 'v0.9.9')).toBe(true)
    expect(isNewer('no-es-version', '0.1.0')).toBe(false)
  })

  it('checkForUpdate pide la última release del repositorio y devuelve versión y url si es más nueva', async () => {
    let asked = ''
    const fetchImpl = (async (url: string | URL | Request) => {
      asked = String(url)
      return new Response(JSON.stringify({ tag_name: 'v0.2.0', html_url: 'https://github.com/x/rev-studio/releases/tag/v0.2.0' }), { status: 200 })
    }) as FetchLike
    expect(await checkForUpdate('0.1.0', fetchImpl)).toEqual({ version: '0.2.0', url: 'https://github.com/x/rev-studio/releases/tag/v0.2.0' })
    expect(asked).toBe(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`)
  })

  it('devuelve null si es la misma versión o una anterior', async () => {
    expect(await checkForUpdate('0.1.0', respond(200, { tag_name: 'v0.1.0', html_url: 'https://github.com/x' }))).toBeNull()
    expect(await checkForUpdate('0.3.0', respond(200, { tag_name: 'v0.2.0', html_url: 'https://github.com/x' }))).toBeNull()
  })

  it('devuelve null si fetch falla, responde 404 o 403, o la respuesta no tiene la forma esperada', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as FetchLike
    expect(await checkForUpdate('0.1.0', failing)).toBeNull()
    expect(await checkForUpdate('0.1.0', respond(404, { message: 'Not Found' }))).toBeNull()
    expect(await checkForUpdate('0.1.0', respond(403, { message: 'API rate limit exceeded' }))).toBeNull()
    expect(await checkForUpdate('0.1.0', respond(200, { tag_name: 'v9.9.9' }))).toBeNull()
    expect(await checkForUpdate('0.1.0', respond(200, { tag_name: 'v9.9.9', html_url: 'http://evil.example' }))).toBeNull()
  })
})
