<script setup lang="ts">
import {
  useNotificationCenterStore,
  type SnackbarQueueItem,
} from '@/stores/notification-center'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const store = useNotificationCenterStore()
const { snackbarQueue } = storeToRefs(store)

const manualCloseIds = new Set<string>()
const queueModel = ref<SnackbarQueueItem[]>([])
const activeDisplayId = ref<string | null>(null)

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
    activeDisplayId.value = prev[0].notificationId
    manualCloseIds.delete(prev[0].notificationId)
  }
  queueModel.value = next
  store.replaceSnackbarQueue(next)
}

function onSnackbarClosed(notificationId: string, visible: boolean): void {
  if (visible) return
  if (activeDisplayId.value !== notificationId) return
  const reason = manualCloseIds.has(notificationId) ? 'close' : 'timeout'
  manualCloseIds.delete(notificationId)
  activeDisplayId.value = null
  store.dismissSnackbar(notificationId, reason)
}

function onIconClose(item: SnackbarQueueItem, closeFn: () => void): void {
  manualCloseIds.add(item.notificationId)
  closeFn()
}

function onActionClick(item: SnackbarQueueItem, closeFn: () => void): void {
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
        @click="onActionClick(item as SnackbarQueueItem, closeProps.onClick)"
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
