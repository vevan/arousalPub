<script setup lang="ts">
import {
  dispatchPluginPanelDomEvent,
  getActivePanelHtml,
  getRegisteredPanels,
  notifyPluginPanelMounted,
  openPluginPanel,
  pluginPanelActiveTab,
  pluginPanelPinned,
  pluginPanelRevision,
  setPluginPanelPinned,
} from '@/plugins/plugin-panel-registry'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, te } = useI18n()

const panels = computed(() => {
  void pluginPanelRevision.value
  return getRegisteredPanels('leftDrawer')
})
const active = computed(() => {
  void pluginPanelRevision.value
  void pluginPanelActiveTab.value
  return getActivePanelHtml('leftDrawer')
})
const contentRef = ref<HTMLElement | null>(null)

function tabLabel(key: string): string {
  return te(key) ? t(key) : key
}

function onPinClick(): void {
  setPluginPanelPinned('leftDrawer', !pluginPanelPinned.value)
}

function onTabClick(pluginId: string): void {
  pluginPanelActiveTab.value = pluginId
  openPluginPanel('leftDrawer', pluginId)
}

function onPanelEvent(ev: Event): void {
  const root = contentRef.value
  if (!root) return
  dispatchPluginPanelDomEvent(root, ev)
}

watch(
  () => [active.value?.html, active.value?.revision, pluginPanelRevision.value],
  () => {
    notifyPluginPanelMounted()
  },
)
</script>

<template>
  <div class="plugin-left-drawer">
    <div class="plugin-left-drawer__header">
      <span class="plugin-left-drawer__title text-subtitle-2">
        {{ $t('app.plugins') }}
      </span>
      <div class="plugin-left-drawer__actions">
        <v-btn
          icon
          size="x-small"
          variant="text"
          :color="pluginPanelPinned ? 'primary' : undefined"
          :aria-label="$t('app.pluginPanelPin')"
          @click="onPinClick"
        >
          <v-icon size="18">
            {{ pluginPanelPinned ? 'mdi-pin' : 'mdi-pin-outline' }}
          </v-icon>
        </v-btn>
        <v-btn
          v-for="p in panels"
          :key="p.pluginId"
          icon
          size="x-small"
          variant="text"
          :color="pluginPanelActiveTab === p.pluginId ? 'primary' : undefined"
          :aria-label="tabLabel(p.tabLabelKey)"
          @click="onTabClick(p.pluginId)"
        >
          <v-icon size="18">{{ p.tabIcon }}</v-icon>
        </v-btn>
      </div>
    </div>

    <template v-if="panels.length > 0">
      <div
        v-if="active?.html"
        ref="contentRef"
        class="plugin-left-drawer__content"
        data-plugin-panel-host
        :data-plugin-panel="active.pluginId"
        v-html="active.html"
        @click="onPanelEvent"
        @change="onPanelEvent"
        @input="onPanelEvent"
      />
      <div
        v-else
        class="plugin-left-drawer__empty text-body-2 text-medium-emphasis pa-4"
      >
        {{ $t('app.pluginPanelEmpty') }}
      </div>
    </template>
    <div
      v-else
      class="plugin-left-drawer__empty text-body-2 text-medium-emphasis pa-4"
    >
      {{ $t('app.pluginsHint') }}
    </div>
  </div>
</template>

<style scoped>
.plugin-left-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.plugin-left-drawer__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface-variant));
  flex-shrink: 0;
}

.plugin-left-drawer__title {
  flex: 1;
  min-width: 0;
  font-weight: 500;
}

.plugin-left-drawer__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.plugin-left-drawer__content {
  flex: 1;
  min-height: 0;
  padding: 8px;
  overflow: auto;
}

.plugin-left-drawer__empty {
  flex: 1;
  min-height: 0;
}
</style>
