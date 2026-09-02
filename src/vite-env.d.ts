/// <reference types="vite/client" />

/** Injected by Vite from package.json — see `define` in vite.config.ts. */
declare const __APP_VERSION__: string

/** True only under `forge dev`, where the Vite plugin serves a project from disk. */
declare const __FORGE_PROJECT__: boolean

/** `firestore` builds the bundle for the backoffice, where the host page provides Firebase. */
interface ImportMetaEnv {
  readonly VITE_FORGE_ADAPTER?: 'file' | 'firestore'
}
