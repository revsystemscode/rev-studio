import { useSyncExternalStore } from 'react'

const query = () => window.matchMedia('(prefers-color-scheme: dark)')

/** Tema del sistema, actualizado en vivo cuando cambia. */
export function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(
    (onChange) => {
      const mq = query()
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => (query().matches ? 'dark' : 'light'),
  )
}
