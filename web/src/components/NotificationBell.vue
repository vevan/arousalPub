<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useNotificationCenterStore } from '@/stores/notification-center'
import { executeNotificationAction } from '@/utils/notification-action'
import type { NotificationRecord } from '@/utils/notification-storage'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const auth = useAuthStore()
const notificationCenter = useNotificationCenterStore()
const { unreadCount } = storeToRefs(notificationCenter)

const menuOpen = ref(false)

watch(
  () => auth.user?.id,
  (id) => {
    notificationCenter.bindUser(id ?? null)
  },
  { immediate: true },
)

const displayItems = computed(() => notificationCenter.list({ limit: 50 }))

function levelIcon(level?: NotificationRecord['level']): string {
  switch (level) {
    case 'success':
      return 'mdi-check-circle-outline'
    case 'error':
      return 'mdi-alert-circle-outline'
    case 'warning':
      return 'mdi-alert-outline'
    case 'info':
    default:
      return 'mdi-information-outline'
  }
}

function levelColor(level?: NotificationRecord['level']): string {
  switch (level) {
    case 'success':
      return 'success'
    case 'error':
      return 'error'
    case 'warning':
      return 'warning'
    case 'info':
    default:
      return 'info'
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function onItemClick(item: NotificationRecord): void {
  if (!item.readAt) {
    notificationCenter.markRead(item.id)
  }
  if (item.action) {
    void executeNotificationAction(item.action)
  }
}

function onDelete(item: NotificationRecord, event: Event): void {
  event.stopPropagation()
  notificationCenter.delete(item.id)
}

function onDeleteAll(): void {
  notificationCenter.deleteAll()
}
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="bottom end"
    :offset="8"
    width="320"
    content-class="notification-bell__menu"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        icon
        variant="text"
        size="small"
        density="comfortable"
        class="app-bar__icon-btn"
        :aria-label="t('notifications.title')"
      >
        <v-badge
          :content="unreadCount > 99 ? '99+' : unreadCount"
          :model-value="unreadCount > 0"
          color="error"
          floating
        >
          <v-icon icon="mdi-bell-outline" />
        </v-badge>
      </v-btn>
    </template>

    <v-card rounded="lg" class="notification-bell__panel" width="320">
      <v-card-title class="d-flex align-center py-2 px-3">
        <span class="text-subtitle-1 font-weight-medium">
          {{ t('notifications.title') }}
        </span>
        <v-spacer />
        <v-btn
          v-if="displayItems.length > 0"
          variant="text"
          size="small"
          class="text-none"
          color="error"
          @click="onDeleteAll"
        >
          {{ t('notifications.deleteAll') }}
        </v-btn>
      </v-card-title>
      <v-divider />

      <div
        v-if="displayItems.length === 0"
        class="notification-bell__empty pa-6 text-center text-medium-emphasis text-body-2"
      >
        {{ t('notifications.empty') }}
      </div>

      <v-list
        v-else
        density="compact"
        class="notification-bell__list py-1"
        max-height="24rem"
      >
        <v-list-item
          v-for="item in displayItems"
          :key="item.id"
          :class="{
            'notification-bell__item--unread': !item.readAt,
            'notification-bell__item--read': !!item.readAt,
          }"
          rounded="lg"
          class="notification-bell__item mx-1"
          :ripple="!item.readAt"
          @click="onItemClick(item)"
        >
          <template #prepend>
            <v-icon
              :icon="levelIcon(item.level)"
              :color="levelColor(item.level)"
              size="16"
              class="notification-bell__level-icon"
            />
          </template>

          <v-list-item-title class="text-body-2 font-weight-medium text-wrap">
            {{ item.title }}
          </v-list-item-title>
          <v-list-item-subtitle
            v-if="item.body"
            class="text-wrap text-pre-wrap"
          >
            {{ item.body }}
          </v-list-item-subtitle>
          <v-list-item-subtitle class="text-caption mt-1">
            {{ formatTime(item.createdAt) }}
          </v-list-item-subtitle>

          <template #append>
            <v-btn
              icon="mdi-delete-outline"
              variant="text"
              size="x-small"
              density="compact"
              class="notification-bell__delete-btn"
              :aria-label="t('notifications.delete')"
              @click="onDelete(item, $event)"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </v-menu>
</template>

<style scoped>
.notification-bell__panel {
  overflow: hidden;
  box-sizing: border-box;
}

.notification-bell__list {
  overflow-y: auto;
}

.notification-bell__item :deep(.v-list-item__prepend) {
  align-self: flex-start;
  width: 1.125rem;
  min-width: 1.125rem;
  margin-inline-end: 0.5rem;
  padding-top: 0.125rem;
}

.notification-bell__item :deep(.v-list-item__prepend > .v-icon) {
  margin-inline-end: 0;
  opacity: 1;
}

.notification-bell__level-icon {
  flex-shrink: 0;
}

.notification-bell__item :deep(.v-list-item__content) {
  min-width: 0;
}

.notification-bell__item :deep(.v-list-item__append) {
  align-self: flex-start;
  padding-top: 0;
}

.notification-bell__item--unread {
  background: rgba(var(--v-theme-primary), 0.06);
  cursor: pointer;
}

.notification-bell__item--read {
  opacity: 0.72;
}

.notification-bell__delete-btn {
  opacity: 0.55;
}

.notification-bell__item:hover .notification-bell__delete-btn {
  opacity: 1;
}

.notification-bell__empty {
  min-height: 6rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

<!-- overlay 挂到 body，须非 scoped -->
<style>
.v-overlay__content.notification-bell__menu {
  min-width: 20rem;
  max-width: 22rem;
  width: 20rem;
}
</style>
