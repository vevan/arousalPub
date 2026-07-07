import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fork, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPluginServerHostApi } from './host-api.js'
import type { PluginServerHostApi } from './types.js'
import type {
  PluginWorkerHostToWorker,
  PluginWorkerWorkerToHost,
} from './plugin-worker-protocol.js'
import {
  PLUGIN_WORKER_INVOKE_TIMEOUT_MS,
  PLUGIN_WORKER_TERMINATE_TIMEOUT_MS,
} from './plugin-worker-protocol.js'
import { buildPluginSandboxExecArgv } from './plugin-worker-permissions.js'
import { buildPluginSandboxChildEnv } from './plugin-worker-env.js'

const WORKER_BOOTSTRAP = fileURLToPath(
  new URL('./plugin-worker-bootstrap.mjs', import.meta.url),
)

type PendingInvoke = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class PluginWorkerClient {
  private child: ChildProcess | null = null
  private ready = false
  private exportedHooks = new Set<string>()
  private readyPromise: Promise<void> | null = null
  private readonly pendingInvokes = new Map<string, PendingInvoke>()

  constructor(
    private readonly pluginId: string,
    private readonly entryPath: string,
  ) {}

  private ensureBootstrapExists(): void {
    if (!existsSync(WORKER_BOOTSTRAP)) {
      throw new Error(`plugin_worker_bootstrap_missing:${WORKER_BOOTSTRAP}`)
    }
  }

  async start(): Promise<void> {
    if (this.ready) return
    if (this.readyPromise) return this.readyPromise

    this.ensureBootstrapExists()
    const resolvedEntry = path.resolve(this.entryPath)
    this.readyPromise = new Promise((resolve, reject) => {
      const execArgv = buildPluginSandboxExecArgv(resolvedEntry, WORKER_BOOTSTRAP)
      const child = fork(WORKER_BOOTSTRAP, [], {
        execArgv,
        env: buildPluginSandboxChildEnv(resolvedEntry),
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
      this.child = child

      child.on('message', (msg: PluginWorkerWorkerToHost) => {
        this.onChildMessage(msg, resolve, reject)
      })
      child.on('error', (err) => {
        reject(err)
        this.failAllPending(err)
      })
      child.on('exit', (code) => {
        if (code !== 0 && !this.ready) {
          reject(new Error(`plugin_worker_exit:${code}`))
        }
        this.child = null
        this.ready = false
        this.readyPromise = null
        this.failAllPending(new Error(`plugin_worker_exit:${code ?? 'unknown'}`))
      })
    })

    return this.readyPromise
  }

  private onChildMessage(
    msg: PluginWorkerWorkerToHost,
    resolveReady: () => void,
    rejectReady: (err: Error) => void,
  ): void {
    if (msg.type === 'ready') {
      this.ready = true
      this.exportedHooks = new Set(
        Array.isArray(msg.hooks) ? msg.hooks.filter((h) => typeof h === 'string') : [],
      )
      resolveReady()
      return
    }
    if (msg.type === 'error') {
      rejectReady(new Error(msg.message))
      return
    }
    if (msg.type === 'invokeResult') {
      const pending = this.pendingInvokes.get(msg.id)
      if (!pending) return
      this.pendingInvokes.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.error) pending.reject(new Error(msg.error))
      else pending.resolve(msg.result)
      return
    }
    if (msg.type === 'apiRequest') {
      void this.handleApiRequest(msg.id, msg.path, msg.args, msg.userId)
    }
  }

  private async handleApiRequest(
    id: string,
    pathParts: string[],
    args: unknown[],
    userId?: string,
  ): Promise<void> {
    const api = createPluginServerHostApi(this.pluginId, userId)
    try {
      const result = await dispatchHostApiCall(api, pathParts, args)
      this.postToChild({ type: 'apiResponse', id, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.postToChild({ type: 'apiResponse', id, error: message })
    }
  }

  private postToChild(msg: PluginWorkerHostToWorker): void {
    this.child?.send(msg)
  }

  getExportedHooks(): ReadonlySet<string> {
    return this.exportedHooks
  }

  async invoke<T = unknown>(
    hook: string,
    args: unknown[],
    userId?: string,
  ): Promise<T> {
    await this.start()
    if (!this.child) throw new Error('plugin_worker_not_running')

    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInvokes.delete(id)
        reject(new Error(`plugin_worker_invoke_timeout:${hook}`))
      }, PLUGIN_WORKER_INVOKE_TIMEOUT_MS)

      this.pendingInvokes.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      })
      this.postToChild({ type: 'invoke', id, hook, args, userId })
    })
  }

  private failAllPending(err: Error): void {
    for (const pending of this.pendingInvokes.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pendingInvokes.clear()
  }

  async shutdown(): Promise<void> {
    if (!this.child) return
    const child = this.child
    this.failAllPending(new Error('plugin_worker_shutdown'))
    this.postToChild({ type: 'shutdown' })

    await Promise.race([
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
      }),
      new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error('plugin_worker_terminate_timeout')),
          PLUGIN_WORKER_TERMINATE_TIMEOUT_MS,
        )
      }),
    ]).catch(() => {
      child.kill('SIGTERM')
    })

    this.child = null
    this.ready = false
    this.readyPromise = null
  }
}

async function dispatchHostApiCall(
  api: PluginServerHostApi,
  pathParts: string[],
  args: unknown[],
): Promise<unknown> {
  if (pathParts.length === 0) throw new Error('invalid_api_path')

  if (pathParts[0] === 'regex' && pathParts.length === 2) {
    const method = pathParts[1]!
    const regexApi = api.regex as Record<
      string,
      (...a: unknown[]) => unknown
    >
    const fn = regexApi[method]
    if (typeof fn !== 'function') throw new Error(`unknown_api:${method}`)
    return fn(...args)
  }

  const top = pathParts[0]!
  const fn = (api as unknown as Record<string, (...a: unknown[]) => unknown>)[
    top
  ]
  if (typeof fn !== 'function') throw new Error(`unknown_api:${top}`)
  return fn(...args)
}

const workerClients = new Map<string, PluginWorkerClient>()

export function getPluginWorkerClient(
  pluginId: string,
  entryPath: string,
): PluginWorkerClient {
  const key = `${pluginId}\0${entryPath}`
  let client = workerClients.get(key)
  if (!client) {
    client = new PluginWorkerClient(pluginId, entryPath)
    workerClients.set(key, client)
  }
  return client
}

export async function shutdownAllPluginWorkers(): Promise<void> {
  await Promise.all([...workerClients.values()].map((c) => c.shutdown()))
  workerClients.clear()
}

/** 单测清理 */
export async function __resetPluginWorkersForTest(): Promise<void> {
  await shutdownAllPluginWorkers()
}
