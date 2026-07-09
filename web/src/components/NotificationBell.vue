<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useNotificationCenterStore } from '@/stores/notification-center'
import { executeNotificationAction } from '@/utils/notification-action'
import {
  desktopNotifyPermission,
  readDesktopNotifyEnabled,
  requestDesktopNotifyPermission,
  writeDesktopNotifyEnabled,
} from '@/utils/desktop-notification'
import { collectPluginIds } from '@/utils/notification-list-filter'
import type {
  NotificationLevel,
  NotificationRecord,
} from '@/utils/notification-storage'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const auth = useAuthStore()
const notificationCenter = useNotificationCenterStore()
const { unreadCount } = storeToRefs(notificationCenter)

const menuOpen = ref(false)
const readFilter = ref<'all' | 'unread'>('all')
const levelFilter = ref<NotificationLevel | null>(null)
const sourceFilter = ref<'all' | 'core' | 'plugin'>('all')
const pluginIdFilter = ref<string | null>(null)
const searchQuery = ref('')
const desktopNotifyEnabled = ref(readDesktopNotifyEnabled())
const desktopNotifyPermissionState = ref(desktopNotifyPermission())

watch(
  () => auth.user?.id,
  (id) => {
    notificationCenter.bindUser(id ?? null)
    notificationCenter.purgeExpired()
  },
  { immediate: true },
)

const levelFilterItems = computed(() => [
  { title: t('notifications.filterLevelAll'), value: null },
  { title: t('notifications.levelInfo'), value: 'info' as const },
  { title: t('notifications.levelSuccess'), value: 'success' as const },
  { title: t('notifications.levelWarning'), value: 'warning' as const },
  { title: t('notifications.levelError'), value: 'error' as const },
])

const pluginFilterItems = computed(() => {
  const ids = collectPluginIds(notificationCenter.items)
  return [
    { title: t('notifications.filterPluginAll'), value: null },
    ...ids.map((id) => ({ title: id, value: id })),
  ]
})

const listSourceFilter = computed(() => {
  if (sourceFilter.value === 'all') return undefined
  if (sourceFilter.value === 'plugin' && pluginIdFilter.value) {
    return { kind: 'plugin' as const, pluginId: pluginIdFilter.value }
  }
  return { kind: sourceFilter.value }
})

const listFilterBase = computed(() => ({
  unreadOnly: readFilter.value === 'unread',
  level: levelFilter.value ?? undefined,
  source: listSourceFilter.value,
  searchQuery: searchQuery.value,
}))

const hasActiveFilter = computed(
  () =>
    readFilter.value === 'unread' ||
    levelFilter.value != null ||
    sourceFilter.value !== 'all' ||
    pluginIdFilter.value != null ||
    searchQuery.value.trim().length > 0,
)

const filteredItemsForDelete = computed(() =>
  notificationCenter.list(listFilterBase.value),
)

const displayItems = computed(() =>
  notificationCenter.list({ ...listFilterBase.value, limit: 50 }),
)

watch(sourceFilter, (next) => {
  if (next !== 'plugin') pluginIdFilter.value = null
})

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
  if (hasActiveFilter.value) {
    const ids = filteredItemsForDelete.value.map((item) => item.id)
    if (ids.length > 0) notificationCenter.delete(ids)
    return
  }
  notificationCenter.deleteAll()
}

const showBulkDelete = computed(() =>
  hasActiveFilter.value
    ? filteredItemsForDelete.value.length > 0
    : notificationCenter.items.length > 0,
)

function onMarkAllRead(): void {
  notificationCenter.markRead('all')
}

async function onDesktopNotifyToggle(enabled: boolean | null): Promise<void> {
  const next = enabled === true
  if (next) {
    const permission = await requestDesktopNotifyPermission()
    desktopNotifyPermissionState.value = permission
    if (permission !== 'granted') {
      desktopNotifyEnabled.value = false
      writeDesktopNotifyEnabled(false)
      return
    }
  }
  desktopNotifyEnabled.value = next
  writeDesktopNotifyEnabled(next)
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
        <v-btn
          v-if="showBulkDelete"
          variant="text"
          size="small"
          class="text-none"
          color="error"
          @click="onDeleteAll"
        >
          {{
            hasActiveFilter
              ? t('notifications.deleteFiltered')
              : t('notifications.deleteAll')
          }}
        </v-btn>
      </v-card-title>
      <v-divider />
      <div class="notification-bell__search px-3 pt-2">
        <v-text-field
          v-model="searchQuery"
          density="compact"
          hide-details
          clearable
          variant="outlined"
          prepend-inner-icon="mdi-magnify"
          :placeholder="t('notifications.searchPlaceholder')"
        />
      </div>
      <div class="notification-bell__filters px-3 py-2 d-flex flex-wrap ga-2 align-center">
        <v-btn-toggle
          v-model="readFilter"
          density="compact"
          divided
          mandatory
        >
          <v-btn value="all" size="small" class="text-none">
            {{ t('notifications.filterAll') }}
          </v-btn>
          <v-btn value="unread" size="small" class="text-none">
            {{ t('notifications.filterUnread') }}
          </v-btn>
        </v-btn-toggle>
        <v-select
          v-model="levelFilter"
          :items="levelFilterItems"
          item-title="title"
          item-value="value"
          density="compact"
          hide-details
          variant="outlined"
          class="notification-bell__level-select"
          :label="t('notifications.filterLevel')"
        />
        <v-btn-toggle
          v-model="sourceFilter"
          density="compact"
          divided
          mandatory
        >
          <v-btn value="all" size="small" class="text-none">
            {{ t('notifications.filterAll') }}
          </v-btn>
          <v-btn value="core" size="small" class="text-none">
            {{ t('notifications.filterSourceCore') }}
          </v-btn>
          <v-btn value="plugin" size="small" class="text-none">
            {{ t('notifications.filterSourcePlugin') }}
          </v-btn>
        </v-btn-toggle>
        <v-select
          v-if="sourceFilter === 'plugin' && pluginFilterItems.length > 1"
          v-model="pluginIdFilter"
          :items="pluginFilterItems"
          item-title="title"
          item-value="value"
          density="compact"
          hide-details
          variant="outlined"
          class="notification-bell__plugin-select"
          :label="t('notifications.filterPlugin')"
        />
      </div>
      <div class="notification-bell__desktop-toggle px-3 pb-2">
        <v-switch
          :model-value="desktopNotifyEnabled"
          density="compact"
          hide-details
          color="primary"
          :disabled="desktopNotifyPermissionState === 'denied' || desktopNotifyPermissionState === 'unsupported'"
          :label="t('notifications.desktopNotify')"
          @update:model-value="onDesktopNotifyToggle"
        />
        <div
          v-if="desktopNotifyPermissionState === 'denied'"
          class="text-caption text-medium-emphasis"
        >
          {{ t('notifications.desktopNotifyDenied') }}
        </div>
      </div>
      <v-divider />

      <div
        v-if="displayItems.length === 0"
        class="notification-bell__empty pa-6 text-center text-medium-emphasis text-body-2"
      >
        {{
          searchQuery.trim() || readFilter === 'unread' || levelFilter || sourceFilter !== 'all' || pluginIdFilter
            ? t('notifications.emptyFiltered')
            : t('notifications.empty')
        }}
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
.notification-bell__plugin-select {
  flex: 1 1 100%;
  min-width: 0;
}

.notification-bell__level-select {
  flex: 1 1 7rem;
  min-width: 7rem;
  max-width: 9rem;
}

.notification-bell__filters {
  gap: 0.5rem;
}

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
