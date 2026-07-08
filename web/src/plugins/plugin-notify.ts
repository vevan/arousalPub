import { showPluginNotifySnackbar } from '@/plugins/plugin-ui-state'
import type { PluginNotifyOptions } from '@/plugins/types'
import { useNotificationCenterStore } from '@/stores/notification-center'

export type PluginNotifyContext = {
  userId?: string | null
  pluginId?: string | null
}

function levelToColor(level?: PluginNotifyOptions['level']): string | undefined {
  switch (level) {
    case 'success':
      return 'success'
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'info':
      return 'info'
    default:
      return undefined
  }
}

function snackbarMessage(title: string, body?: string): string {
  return body?.trim() ? `${title}\n${body}` : title
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

  const record = store.send({
    title,
    body: body?.trim() || undefined,
    level: opts?.level,
    source: ctx.pluginId
      ? { kind: 'plugin', pluginId: ctx.pluginId }
      : { kind: 'core' },
    action: opts?.action,
    snackbarActions: opts?.snackbarActions,
    dedupeKey: opts?.dedupeKey,
  })

  if (opts?.snackbar !== false) {
    showPluginNotifySnackbar(record.id, snackbarMessage(title, body), {
      color: opts?.color ?? levelToColor(opts?.level) ?? 'surface-variant',
      timeout: opts?.timeout ?? 4000,
      snackbarActions: opts?.snackbarActions,
    })
  }

  return record.id
}
