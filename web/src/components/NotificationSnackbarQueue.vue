<script setup lang="ts">
import {
  useNotificationCenterStore,
  type SnackbarQueueItem,
} from '@/stores/notification-center'
import type { NotificationSnackbarAction } from '@/utils/notification-storage'
import { executeNotificationAction } from '@/utils/notification-action'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const store = useNotificationCenterStore()
const { snackbarQueue } = storeToRefs(store)

const manualCloseIds = new Set<string>()
/** 已在 onIconClose / onActionClick 中 commit 过 store，避免后续 handler 误判为 timeout */
const handledDismissIds = new Set<string>()
const queueModel = ref<SnackbarQueueItem[]>([])
const activeDisplayId = ref<string | null>(null)

function clearDismissTracking(notificationId: string): void {
  manualCloseIds.delete(notificationId)
  handledDismissIds.delete(notificationId)
  if (activeDisplayId.value === notificationId) {
    activeDisplayId.value = null
  }
}

function syncQueueModelFromStore(): void {
  queueModel.value = [...snackbarQueue.value]
}

watch(
  snackbarQueue,
  () => {
    syncQueueModelFromStore()
  },
  { deep: true },
)

function onQueueModelUpdate(next: SnackbarQueueItem[]): void {
  const prev = queueModel.value
  if (next.length < prev.length && prev[0]) {
    const removedId = prev[0].notificationId
    const headRemoved = !next.some((item) => item.notificationId === removedId)
    if (headRemoved) {
      if (handledDismissIds.has(removedId)) {
        clearDismissTracking(removedId)
      } else {
        const reason = manualCloseIds.has(removedId) ? 'close' : 'timeout'
        clearDismissTracking(removedId)
        store.dismissSnackbar(removedId, reason)
      }
    }
  }
  queueModel.value = next
  store.replaceSnackbarQueue(next)
}

function onSnackbarClosed(notificationId: string, visible: boolean): void {
  if (visible) {
    activeDisplayId.value = notificationId
    return
  }
  if (handledDismissIds.has(notificationId)) {
    clearDismissTracking(notificationId)
    return
  }
  const reason = manualCloseIds.has(notificationId) ? 'close' : 'timeout'
  clearDismissTracking(notificationId)
  store.dismissSnackbar(notificationId, reason)
}

function onIconClose(item: SnackbarQueueItem, closeFn: () => void): void {
  manualCloseIds.add(item.notificationId)
  handledDismissIds.add(item.notificationId)
  store.dismissSnackbar(item.notificationId, 'close')
  closeFn()
}

function onActionClick(
  item: SnackbarQueueItem,
  snackAction: NotificationSnackbarAction,
  closeFn: () => void,
): void {
  if (snackAction.action) {
    void executeNotificationAction(snackAction.action)
  }
  handledDismissIds.add(item.notificationId)
  store.dismissSnackbar(item.notificationId, 'action')
  closeFn()
}

onMounted(() => {
  syncQueueModelFromStore()
  store.registerSnackbarHooks({
    wrapQueueItem(item) {
      const notificationId = item.notificationId
      return {
        ...item,
        multiLine: true,
        'onUpdate:modelValue': (visible: boolean) => {
          onSnackbarClosed(notificationId, visible)
        },
      }
    },
  })
})

onUnmounted(() => {
  store.registerSnackbarHooks({})
})
</script>

<template>
  <v-snackbar-queue
    v-model="queueModel"
    location="bottom"
    :closable="false"
    @update:model-value="onQueueModelUpdate"
  >
    <template #actions="{ item, props: closeProps }">
      <v-btn
        v-for="(action, index) in (item as SnackbarQueueItem).snackbarActions ?? []"
        :key="`${action.label}-${index}`"
        variant="text"
        @click="onActionClick(item as SnackbarQueueItem, action, closeProps.onClick)"
      >
        {{ action.label }}
      </v-btn>
      <v-btn
        icon="mdi-close"
        variant="text"
        :aria-label="t('pluginHost.snackbarClose')"
        @click="onIconClose(item as SnackbarQueueItem, closeProps.onClick)"
      />
    </template>
  </v-snackbar-queue>
</template>
