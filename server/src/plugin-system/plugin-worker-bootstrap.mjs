/**
 * Plugin 沙箱子进程入口（DOC/38 Phase B/C）
 * fork 加载 dist/server.mjs；Host API 经 process.send IPC 代理。
 * 进程级隔离 + Node --permission（见 plugin-worker-permissions.ts）。
 */
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { HOOKS_WITH_API } from './plugin-worker-hooks.mjs'

// import hook 内部用 Worker；启用 --permission 时由进程级 fs 限制替代
if (!process.permission) {
  const { register } = await import('node:module')
  register('./plugin-worker-import-hook.mjs', import.meta.url)
}

const API_REQUEST_TIMEOUT_MS = 120_000

/** @type {Record<string, unknown> | null} */
let pluginModule = null

/** @type {Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>} */
const pendingApi = new Map()

/** invoke 串行队列 */
let invokeChain = Promise.resolve()

function denyRawNetwork() {
  globalThis.fetch = () =>
    Promise.reject(new Error('plugin_worker_fetch_denied'))
  if (typeof globalThis.WebSocket !== 'undefined') {
    globalThis.WebSocket = function pluginWorkerWebSocketDenied() {
      throw new Error('plugin_worker_websocket_denied')
    }
  }
}

denyRawNetwork()

function postToHost(msg) {
  if (typeof process.send === 'function') {
    process.send(msg)
  }
}

/**
 * @param {string[]} pathParts
 * @param {unknown[]} args
 * @param {string | undefined} userId
 */
function callHostApi(pathParts, args, userId) {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => {
      pendingApi.delete(id)
      reject(new Error('plugin_worker_api_timeout'))
    }, API_REQUEST_TIMEOUT_MS)

    pendingApi.set(id, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
      timer,
    })
    postToHost({ type: 'apiRequest', id, path: pathParts, args, userId })
  })
}

function createApiProxy(userId) {
  const fn = () => {}
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'then' || prop === 'constructor' || prop === Symbol.toStringTag) {
        return undefined
      }
      if (prop === 'regex') {
        return new Proxy(
          {},
          {
            get(_t, regexProp) {
              if (
                regexProp === 'then' ||
                regexProp === 'constructor' ||
                typeof regexProp !== 'string'
              ) {
                return undefined
              }
              return (...args) => callHostApi(['regex', regexProp], args, userId)
            },
          },
        )
      }
      if (typeof prop !== 'string') return undefined
      return (...args) => callHostApi([prop], args, userId)
    },
  })
}

async function loadPluginModule() {
  if (pluginModule) return pluginModule
  const entryPath = process.env.PLUGIN_WORKER_ENTRY_PATH
  if (typeof entryPath !== 'string' || !entryPath.trim()) {
    throw new Error('worker_entry_path_required')
  }
  pluginModule = await import(pathToFileURL(entryPath).href)
  return pluginModule
}

/** @param {import('./plugin-worker-protocol.js').PluginWorkerHostToWorker & { type: 'invoke' }} msg */
async function handleInvoke(msg) {
  const mod = await loadPluginModule()
  const hook = msg.hook
  const fn = mod[hook]
  if (typeof fn !== 'function') {
    postToHost({ type: 'invokeResult', id: msg.id, error: 'hook_not_found' })
    return
  }
  const userId = typeof msg.userId === 'string' ? msg.userId : undefined
  const args = Array.isArray(msg.args) ? [...msg.args] : []
  if (HOOKS_WITH_API.has(hook)) {
    args.push(createApiProxy(userId))
  }
  const result = await fn(...args)
  postToHost({ type: 'invokeResult', id: msg.id, result })
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'apiResponse') {
    const pending = pendingApi.get(msg.id)
    if (!pending) return
    pendingApi.delete(msg.id)
    if (msg.error) pending.reject(new Error(msg.error))
    else pending.resolve(msg.result)
    return
  }

  if (msg.type === 'shutdown') {
    for (const pending of pendingApi.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('plugin_worker_shutdown'))
    }
    pendingApi.clear()
    process.exit(0)
    return
  }

  if (msg.type !== 'invoke') return

  invokeChain = invokeChain
    .then(() => handleInvoke(msg))
    .catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      postToHost({ type: 'invokeResult', id: msg.id, error: message })
    })
})

loadPluginModule()
  .then((mod) => {
    const hooks = Object.keys(mod).filter(
      (k) => typeof /** @type {Record<string, unknown>} */ (mod)[k] === 'function',
    )
    postToHost({ type: 'ready', hooks })
  })
  .catch((e) => {
    postToHost({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    })
  })
