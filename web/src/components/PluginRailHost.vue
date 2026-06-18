<script setup lang="ts">
import {
  dispatchPluginPanelDomEvent,
  getActivePanelHtml,
  getRegisteredPanels,
  isPanelVisibleOnRoute,
  isPluginPanelHidden,
  notifyPluginPanelMounted,
  openPluginPanel,
  pluginPanelRevision,
  setPluginPanelHidden,
  type PluginPanelPlacement,
} from '@/plugins/plugin-panel-registry'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const props = defineProps<{
  placement: PluginPanelPlacement
}>()

const { t, te } = useI18n()
const route = useRoute()

const panels = computed(() => {
  void pluginPanelRevision.value
  return getRegisteredPanels(props.placement)
})
const active = computed(() => {
  void pluginPanelRevision.value
  return getActivePanelHtml(props.placement, route.name as string)
})
const hostHidden = computed(() => isPluginPanelHidden(props.placement))
const showPanelContent = computed(() => Boolean(active.value?.html?.trim()))
const contentRef = ref<HTMLElement | null>(null)

function tabLabel(key: string): string {
  return te(key) ? t(key) : key
}

function panelRoutable(pluginId: string): boolean {
  const entry = panels.value.find((p) => p.pluginId === pluginId)
  if (!entry) return false
  return isPanelVisibleOnRoute(entry, route.name as string)
}

function onToggleHidden(): void {
  setPluginPanelHidden(props.placement, !hostHidden.value)
}

function onTabClick(pluginId: string): void {
  if (!panelRoutable(pluginId)) return
  openPluginPanel(props.placement, pluginId, route.name as string)
}

function onPanelEvent(ev: Event): void {
  const root = contentRef.value
  if (!root) return
  dispatchPluginPanelDomEvent(props.placement, root, ev)
}

watch(
  () => [active.value?.html, active.value?.revision, pluginPanelRevision.value],
  () => {
    notifyPluginPanelMounted()
  },
)
</script>

<template>
  <div class="plugin-rail-host">
    <div class="plugin-rail-host__header">
      <span class="plugin-rail-host__title text-subtitle-2">
        {{ $t('app.plugins') }}
      </span>
      <div class="plugin-rail-host__actions">
        <v-btn
          icon
          size="x-small"
          variant="text"
          :aria-label="$t('app.pluginPanelHide')"
          @click="onToggleHidden"
        >
          <v-icon size="18">mdi-eye-off-outline</v-icon>
        </v-btn>
        <v-btn
          v-for="p in panels"
          :key="p.pluginId"
          icon
          size="x-small"
          variant="text"
          :disabled="!panelRoutable(p.pluginId)"
          :color="
            panelRoutable(p.pluginId) && active?.pluginId === p.pluginId
              ? 'primary'
              : undefined
          "
          :aria-label="tabLabel(p.tabLabelKey)"
          @click="onTabClick(p.pluginId)"
        >
          <v-icon size="18">{{ p.tabIcon }}</v-icon>
        </v-btn>
      </div>
    </div>

    <div
      v-if="showPanelContent"
      ref="contentRef"
      class="plugin-rail-host__content"
      data-plugin-panel-host
      :data-plugin-panel="active?.pluginId"
      v-html="active?.html"
      @click="onPanelEvent"
      @change="onPanelEvent"
      @input="onPanelEvent"
    />
    <div
      v-else
      class="plugin-rail-host__empty text-body-2 text-medium-emphasis pa-4"
    >
      {{ $t('app.pluginRailUnavailable') }}
    </div>
  </div>
</template>

<style scoped>
.plugin-rail-host {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.plugin-rail-host__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgba(var(--v-theme-primary), 0.1);
  flex-shrink: 0;
}

.plugin-rail-host__title {
  flex: 1;
  min-width: 0;
  font-weight: 500;
}

.plugin-rail-host__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.plugin-rail-host__content {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.plugin-rail-host__empty {
  flex: 1;
  min-height: 0;
}
</style>
