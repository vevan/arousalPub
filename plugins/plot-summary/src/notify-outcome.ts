import { k } from './settings.js'
import type { PluginHost } from './types.js'

type OutcomeLevel = 'success' | 'error' | 'warning' | 'info'

/** 任务结果类通知（与默认 notify 相同：立即入列表，手动关浮层则移出列表） */
export function notifyOutcome(
  host: PluginHost,
  key: string,
  level: OutcomeLevel,
  params?: Record<string, unknown>,
): void {
  host.ui.notify(host.t(k(host, key), params), undefined, { level })
}
