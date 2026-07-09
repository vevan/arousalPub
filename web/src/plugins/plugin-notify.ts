import type { PluginNotifyOptions } from '@/plugins/types'
import { useNotificationCenterStore } from '@/stores/notification-center'

export type PluginNotifyContext = {
  userId?: string | null
  pluginId?: string | null
}

export function sendPluginNotify(
  title: string,
  body?: string,
  opts?: PluginNotifyOptions,
  ctx: PluginNotifyContext = {},
): string {
  const store = useNotificationCenterStore()
  if (ctx.userId) {
    store.bindUser(ctx.userId)
  }

  return store.notify({
    title,
    body: body?.trim() || undefined,
    level: opts?.level,
    source: ctx.pluginId
      ? { kind: 'plugin', pluginId: ctx.pluginId }
      : { kind: 'core' },
    action: opts?.action,
    snackbarActions: opts?.snackbarActions,
    dedupeKey: opts?.dedupeKey,
    expiresAt: opts?.expiresAt,
    snackbar: opts?.snackbar,
    persist: opts?.persist,
    timeout: opts?.timeout,
  })
}
