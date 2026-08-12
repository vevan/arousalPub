<script setup lang="ts">
import PluginFloatingWindow from '@/components/PluginFloatingWindow.vue'
import {
  bringFloatingPanelToFront,
  getFloatingPanels,
  getHiddenFloatingPanels,
  pluginPanelRevision,
  setFloatingPanelHidden,
} from '@/plugins/plugin-panel-registry'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const route = useRoute()
const { t, te } = useI18n()
const panels = computed(() => {
  void pluginPanelRevision.value
  return getFloatingPanels(route.name as string)
})
const hiddenPanels = computed(() => {
  void pluginPanelRevision.value
  return getHiddenFloatingPanels(route.name as string)
})

function panelLabel(key: string): string {
  return translatePluginI18nKey(key, t, te)
}

function restore(pluginId: string): void {
  setFloatingPanelHidden(pluginId, false)
  bringFloatingPanelToFront(pluginId)
}
</script>

<template>
  <Teleport to="body">
    <div class="plugin-floating-layer">
      <PluginFloatingWindow
        v-for="panel in panels"
        :key="panel.pluginId"
        :panel="panel"
      />
      <div v-if="hiddenPanels.length" class="plugin-floating-shelf">
        <v-tooltip
          v-for="panel in hiddenPanels"
          :key="panel.pluginId"
          location="top"
          :text="$t('app.pluginPanelRestore', { name: panelLabel(panel.tabLabelKey) })"
        >
          <template #activator="{ props: tooltipProps }">
            <v-btn
              icon
              size="small"
              variant="tonal"
              v-bind="tooltipProps"
              :aria-label="$t('app.pluginPanelRestore', { name: panelLabel(panel.tabLabelKey) })"
              @click="restore(panel.pluginId)"
            >
              <v-icon size="18">{{ panel.tabIcon }}</v-icon>
            </v-btn>
          </template>
        </v-tooltip>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.plugin-floating-layer {
  position: fixed;
  inset: 0;
  z-index: 1200;
  overflow: clip;
  pointer-events: none;
}

.plugin-floating-shelf {
  position: fixed;
  right: 0.75rem;
  bottom: calc(var(--footer-height, 2rem) + 0.75rem);
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: calc(100vw - 1.5rem);
  gap: 0.375rem;
  padding: 0.375rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: var(--radius-sm);
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.22);
  pointer-events: auto;
}
</style>
