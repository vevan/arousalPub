import { ref } from 'vue'

export interface PluginConfirmOptions {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: string
}

interface ConfirmState extends PluginConfirmOptions {
  confirmLabel: string
  cancelLabel: string
  confirmColor: string
  resolve: (value: boolean) => void
}

export const pluginConfirmOpen = ref<ConfirmState | null>(null)

export const pluginSnackbar = ref<{
  message: string
  color: string
  timeout: number
} | null>(null)

export function showPluginConfirm(opts: PluginConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pluginConfirmOpen.value = {
      title: opts.title,
      body: opts.body,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      confirmColor: opts.confirmColor ?? 'error',
      resolve,
    }
  })
}

export function resolvePluginConfirm(value: boolean): void {
  const state = pluginConfirmOpen.value
  if (!state) return
  pluginConfirmOpen.value = null
  state.resolve(value)
}

export function showPluginToast(
  message: string,
  opts?: { color?: string; timeout?: number },
): void {
  pluginSnackbar.value = {
    message,
    color: opts?.color ?? 'surface-variant',
    timeout: opts?.timeout ?? 4000,
  }
}

export function clearPluginSnackbar(): void {
  pluginSnackbar.value = null
}

export interface PluginProgressState {
  message: string
  phase?: string
  done: number
  total: number
  indeterminate?: boolean
  /** 显示「强制中断」并中止进行中的插件 API 请求 */
  abortable?: boolean
  abortLabel?: string
}

export const pluginProgressOpen = ref<PluginProgressState | null>(null)

let progressAbortController: AbortController | null = null

export function getPluginProgressAbortSignal(): AbortSignal | undefined {
  return progressAbortController?.signal
}

export function showPluginProgress(opts: PluginProgressState): void {
  const prev = pluginProgressOpen.value
  const keepAbort =
    Boolean(prev?.abortable && opts.abortable && progressAbortController) &&
    !progressAbortController!.signal.aborted

  if (opts.abortable && !keepAbort) {
    progressAbortController?.abort()
    progressAbortController = new AbortController()
  } else if (!opts.abortable) {
    progressAbortController = null
  }

  pluginProgressOpen.value = opts
}

export function abortPluginProgress(): void {
  if (!pluginProgressOpen.value?.abortable) return
  progressAbortController?.abort()
  clearPluginProgress()
}

export function clearPluginProgress(): void {
  pluginProgressOpen.value = null
  progressAbortController = null
}
