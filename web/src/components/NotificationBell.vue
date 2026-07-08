<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useNotificationCenterStore } from '@/stores/notification-center'
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
      return 'mdi-information-outline'
    default:
      return 'mdi-bell-outline'
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
      return 'info'
    default:
      return 'medium-emphasis'
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function onMarkRead(item: NotificationRecord): void {
  notificationCenter.markRead(item.id)
}

function onDelete(item: NotificationRecord): void {
  notificationCenter.delete(item.id)
}

function onMarkAllRead(): void {
  notificationCenter.markRead('all')
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
          v-if="unreadCount > 0"
          variant="text"
          size="small"
          class="text-none"
          @click="onMarkAllRead"
        >
          {{ t('notifications.markAllRead') }}
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
          :class="{ 'notification-bell__item--unread': !item.readAt }"
          rounded="lg"
          class="notification-bell__item mx-1"
        >
          <template #prepend>
            <v-icon
              :icon="levelIcon(item.level)"
              :color="levelColor(item.level)"
              size="20"
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
            <div class="d-flex flex-column ga-0">
              <v-btn
                v-if="!item.readAt"
                icon="mdi-email-open-outline"
                variant="text"
                size="x-small"
                density="compact"
                :aria-label="t('notifications.markRead')"
                @click.stop="onMarkRead(item)"
              />
              <v-btn
                icon="mdi-delete-outline"
                variant="text"
                size="x-small"
                density="compact"
                :aria-label="t('notifications.delete')"
                @click.stop="onDelete(item)"
              />
            </div>
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

.notification-bell__item :deep(.v-list-item__content) {
  min-width: 0;
}

.notification-bell__item--unread {
  background: rgba(var(--v-theme-primary), 0.06);
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
