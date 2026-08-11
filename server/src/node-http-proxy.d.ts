import 'node:http'

declare module 'node:http' {
  /** Added by Node.js 24.14.0; remove once @types/node ships this declaration. */
  export function setGlobalProxyFromEnv(
    proxyEnv?: NodeJS.ProcessEnv,
  ): () => void
}
