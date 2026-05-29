import { useAuthStore } from '@/stores/auth'

/** 为 /api/*（除 /api/auth）自动附加 Bearer token */
export function installAuthenticatedFetch(): void {
  const native = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const path = url.startsWith('http')
      ? new URL(url).pathname
      : url.split('?')[0] ?? url

    const isApi =
      path.startsWith('/api/') && !path.startsWith('/api/auth')
    if (isApi) {
      const auth = useAuthStore()
      const headers = new Headers(init?.headers)
      if (auth.token) {
        headers.set('Authorization', `Bearer ${auth.token}`)
      }
      return native(input, { ...init, headers })
    }
    return native(input, init)
  }
}
