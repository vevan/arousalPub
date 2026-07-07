/**
 * Plugin Worker 模块解析钩子：禁止读盘、子进程、原生 HTTP 等。
 * 出站须经 Host API 代理（DOC/38 Phase B）。
 */
const DENIED = new Set([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'child_process',
  'node:child_process',
  'worker_threads',
  'node:worker_threads',
  'net',
  'node:net',
  'dgram',
  'node:dgram',
  'tls',
  'node:tls',
  'http',
  'node:http',
  'https',
  'node:https',
  'http2',
  'node:http2',
  'dns',
  'node:dns',
  'dns/promises',
  'node:dns/promises',
  'undici',
  'node:undici',
])

function isDeniedSpecifier(specifier) {
  const base = specifier.split('?')[0]?.trim() ?? ''
  return DENIED.has(base)
}

export async function resolve(specifier, context, nextResolve) {
  if (isDeniedSpecifier(specifier)) {
    throw new Error(`plugin_worker_import_denied:${specifier}`)
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  return nextLoad(url, context)
}
