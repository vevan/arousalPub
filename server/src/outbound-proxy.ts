import { setGlobalProxyFromEnv } from 'node:http'
import type { RawConfig } from './config.js'

type ProxyEnv = NodeJS.ProcessEnv
type ApplyGlobalProxy = (proxyEnv: ProxyEnv) => () => void

export interface OutboundProxyStatus {
  enabled: boolean
  http: boolean
  https: boolean
  noProxy: boolean
  restore: (() => void) | null
}

function assertSupportedProxyUrl(key: string, value: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`[proxy] ${key} must be a valid proxy URL`)
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname
  ) {
    throw new Error(`[proxy] ${key} must use http:// or https://`)
  }
}

/**
 * Configure Node's process-wide HTTP(S) proxy from the operator-owned YAML config.
 * An isolated proxy environment keeps inherited process variables from changing
 * the explicit enable/disable decision.
 */
export function configureOutboundProxyFromConfig(
  config: Pick<RawConfig, 'enableProxy' | 'proxyUrl' | 'proxyNoProxy'>,
  applyGlobalProxy: ApplyGlobalProxy = setGlobalProxyFromEnv,
): OutboundProxyStatus {
  if (
    config.enableProxy !== undefined &&
    typeof config.enableProxy !== 'boolean'
  ) {
    throw new Error('[proxy] enableProxy must be a boolean')
  }

  if (config.enableProxy !== true) {
    return {
      enabled: false,
      http: false,
      https: false,
      noProxy: false,
      restore: null,
    }
  }

  const proxyUrl = typeof config.proxyUrl === 'string'
    ? config.proxyUrl.trim()
    : ''
  if (!proxyUrl) {
    throw new Error('[proxy] proxyUrl is required when enableProxy is true')
  }
  assertSupportedProxyUrl('proxyUrl', proxyUrl)

  if (
    config.proxyNoProxy !== undefined &&
    !Array.isArray(config.proxyNoProxy)
  ) {
    throw new Error('[proxy] proxyNoProxy must be a string array')
  }
  const noProxy = (config.proxyNoProxy ?? []).map((value) => {
    if (typeof value !== 'string') {
      throw new Error('[proxy] proxyNoProxy must contain only strings')
    }
    return value.trim()
  }).filter(Boolean)

  const proxyEnv: ProxyEnv = {
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
  }
  if (noProxy.length > 0) proxyEnv.no_proxy = noProxy.join(',')

  let restore: () => void
  try {
    restore = applyGlobalProxy(proxyEnv)
  } catch {
    // Native errors can contain the proxy URL. Keep credentials out of logs.
    throw new Error(
      '[proxy] failed to configure outbound proxy; check config.yaml proxy settings',
    )
  }

  return {
    enabled: true,
    http: true,
    https: true,
    noProxy: noProxy.length > 0,
    restore,
  }
}
