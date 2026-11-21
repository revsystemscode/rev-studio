import { ToolError } from './types'

/** Un byte nulo en los primeros 8 KB: se trata como binario. */
export function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0)
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

/** Texto UTF-8 válido, o null si es binario o está en otra codificación (Latin-1, Windows-1252…). */
export function decodeUtf8(buf: Buffer): string | null {
  if (looksBinary(buf)) return null
  try {
    return strictUtf8.decode(buf)
  } catch {
    return null
  }
}

/**
 * Contenido de un archivo que se va a modificar. Si no es UTF-8 válido, decodificarlo y reescribirlo
 * cambiaría cada carácter no ASCII por "�" (y la instantánea guardaría ya el texto estropeado),
 * así que se rechaza.
 */
export function editableText(buf: Buffer, displayPath: string): string {
  if (looksBinary(buf)) throw new ToolError(`"${displayPath}" es un archivo binario y no se puede editar como texto.`)
  const text = decodeUtf8(buf)
  if (text === null) {
    throw new ToolError(`"${displayPath}" no está en UTF-8 (quizá Latin-1 o Windows-1252); editarlo lo estropearía. Conviértelo a UTF-8 primero.`)
  }
  return text
}
