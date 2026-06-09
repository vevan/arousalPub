import { resolveUpstreamUrlPolicy } from './config.js'
import {
  assertUpstreamUrlAllowed,
  UpstreamUrlBlockedError,
} from './upstream-url-guard.js'

export const UPSTREAM_FETCH_TIMEOUT_MS = 120_000
export const UPSTREAM_STREAM_FETCH_TIMEOUT_MS = 300_000

const MAX_REDIRECT_HOPS = 5

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function redirectUsesGet(status: number): boolean {
  return status === 301 || status === 302 || status === 303
}

function blockedUpstreamResponse(code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function fetchPublicOnlyWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const policy = resolveUpstreamUrlPolicy()
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs)
  let currentUrl = url
  let currentInit: RequestInit = { ...init, signal, redirect: 'manual' }

  try {
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      assertUpstreamUrlAllowed(currentUrl, policy)
      const res = await fetch(currentUrl, currentInit)

      if (!isRedirectStatus(res.status)) {
        return res
      }

      if (hop >= MAX_REDIRECT_HOPS) {
        return blockedUpstreamResponse('upstream_url_redirect_limit')
      }

      const location = res.headers.get('location')
      if (!location) {
        return res
      }

      currentUrl = new URL(location, currentUrl).href
      if (redirectUsesGet(res.status)) {
        const { body: _body, ...rest } = currentInit
        currentInit = { ...rest, method: 'GET', body: undefined }
      }
    }
  } catch (e) {
    if (e instanceof UpstreamUrlBlockedError) {
      return blockedUpstreamResponse(e.code)
    }
    throw e
  }

  return blockedUpstreamResponse('upstream_url_redirect_limit')
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = UPSTREAM_FETCH_TIMEOUT_MS,
): Promise<Response> {
  if (resolveUpstreamUrlPolicy() === 'public-only') {
    return fetchPublicOnlyWithTimeout(url, init, timeoutMs)
  }
  return fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  })
}
