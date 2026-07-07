/** 插件沙箱子进程 ↔ Host IPC（DOC/38 Phase B/C · child_process.fork） */

export const PLUGIN_WORKER_INVOKE_TIMEOUT_MS = 120_000
export const PLUGIN_WORKER_API_REQUEST_TIMEOUT_MS = 120_000
export const PLUGIN_WORKER_TERMINATE_TIMEOUT_MS = 5_000

export type PluginWorkerHostToWorker =
  | {
      type: 'invoke'
      id: string
      hook: string
      args: unknown[]
      userId?: string
    }
  | {
      type: 'apiResponse'
      id: string
      result?: unknown
      error?: string
    }
  | { type: 'shutdown' }

export type PluginWorkerWorkerToHost =
  | {
      type: 'apiRequest'
      id: string
      path: string[]
      args: unknown[]
      userId?: string
    }
  | {
      type: 'invokeResult'
      id: string
      result?: unknown
      error?: string
    }
  | { type: 'ready'; hooks: string[] }
  | { type: 'error'; message: string }

function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function isPluginServerSandboxEnabled(): boolean {
  return envFlag('PLUGIN_SERVER_SANDBOX')
}

/** 沙箱加载失败时不回退同进程 import */
export function isPluginServerSandboxStrict(): boolean {
  return envFlag('PLUGIN_SERVER_SANDBOX_STRICT')
}
