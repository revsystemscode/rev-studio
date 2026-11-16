import { safeStorage } from 'electron'

/** Cifra con el llavero del sistema (Keychain en macOS, DPAPI en Windows). Devuelve base64. */
export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('El sistema no ofrece almacenamiento seguro; no se puede guardar la clave.')
  }
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptSecret(cipher: string): string {
  return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
}
