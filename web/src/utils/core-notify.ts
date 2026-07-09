import type { PluginNotifyOptions } from '@/plugins/types'
import { useNotificationCenterStore } from '@/stores/notification-center'
import { useAuthStore } from '@/stores/auth'

export function coreNotify(
  title: string,
  body?: string,
  opts?: PluginNotifyOptions,
): string {
  const auth = useAuthStore()
  const store = useNotificationCenterStore()
  if (auth.user?.id) {
    store.bindUser(auth.user.id)
  }
  return store.notify({
    title,
    body: body?.trim() || undefined,
    level: opts?.level,
    source: { kind: 'core' },
    action: opts?.action,
    snackbarActions: opts?.snackbarActions,
    dedupeKey: opts?.dedupeKey,
    expiresAt: opts?.expiresAt,
    snackbar: opts?.snackbar,
    persist: opts?.persist,
    timeout: opts?.timeout,
  })
}
