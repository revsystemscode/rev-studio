import type { RevBridge } from '../preload'

declare global {
  interface Window {
    rev: RevBridge
  }
}
