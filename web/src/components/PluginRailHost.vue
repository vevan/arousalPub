<script setup lang="ts">
import {
  dispatchPluginPanelDomEvent,
  getActivePanelHtml,
  getRegisteredPanels,
  isPluginPanelHidden,
  notifyPluginPanelMounted,
  openPluginPanel,
  pluginPanelRevision,
  setPluginPanelHidden,
  type PluginPanelPlacement,
} from '@/plugins/plugin-panel-registry'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  placement: PluginPanelPlacement
}>()

const { t, te } = useI18n()

const panels = computed(() => {
  void pluginPanelRevision.value
  return getRegisteredPanels(props.placement)
})
const active = computed(() => {
  void pluginPanelRevision.value
  return getActivePanelHtml(props.placement)
})
const hostHidden = computed(() => isPluginPanelHidden(props.placement))
const contentRef = ref<HTMLElement | null>(null)

function tabLabel(key: string): string {
  return te(key) ? t(key) : key
}

function onToggleHidden(): void {
  setPluginPanelHidden(props.placement, !hostHidden.value)
}

function onTabClick(pluginId: string): void {
  openPluginPanel(props.placement, pluginId)
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
          :color="active?.pluginId === p.pluginId ? 'primary' : undefined"
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
        class="plugin-rail-host__content"
        data-plugin-panel-host
        :data-plugin-panel="active.pluginId"
        v-html="active.html"
        @click="onPanelEvent"
        @change="onPanelEvent"
        @input="onPanelEvent"
      />
      <div
        v-else
        class="plugin-rail-host__empty text-body-2 text-medium-emphasis pa-4"
      >
        {{ $t('app.pluginPanelEmpty') }}
      </div>
    </template>
    <div
      v-else
      class="plugin-rail-host__empty text-body-2 text-medium-emphasis pa-4"
    >
      {{ $t('app.pluginsHint') }}
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
  background: rgb(var(--v-theme-surface-variant));
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
  padding: 8px;
  overflow: auto;
}

.plugin-rail-host__empty {
  flex: 1;
  min-height: 0;
}
</style>
