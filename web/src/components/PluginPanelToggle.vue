<script setup lang="ts">
import {
  isPluginPanelHidden,
  openPluginPanel,
  restoreHiddenFloatingPanels,
  type PluginPanelRailPlacement,
} from '@/plugins/plugin-panel-registry'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const props = withDefaults(defineProps<{
  placement?: PluginPanelRailPlacement
  hideWhenVisible?: boolean
}>(), {
  placement: 'leftRail',
  hideWhenVisible: false,
})

const { t } = useI18n()
const route = useRoute()
const hidden = computed(() => isPluginPanelHidden(props.placement))
const tooltip = computed(() => t('app.pluginsShow'))

function openRail(placement: PluginPanelRailPlacement): void {
  openPluginPanel(placement, undefined, route.name as string)
}

function restoreFloating(): void {
  restoreHiddenFloatingPanels(route.name as string)
}
</script>

<template>
  <v-menu
    v-if="!props.hideWhenVisible || hidden"
    location="bottom start"
  >
    <template #activator="{ props: tooltipProps }">
      <v-btn
        icon
        variant="text"
        size="small"
        density="comfortable"
        class="plugin-panel-toggle"
        v-bind="tooltipProps"
        :title="tooltip"
        :aria-label="tooltip"
      >
        <v-icon size="20">mdi-puzzle</v-icon>
      </v-btn>
    </template>
    <v-list density="compact" min-width="11rem">
      <v-list-item
        :title="$t('app.pluginPanelShowLeft')"
        prepend-icon="mdi-dock-left"
        @click="openRail('leftRail')"
      />
      <v-list-item
        :title="$t('app.pluginPanelShowRight')"
        prepend-icon="mdi-dock-right"
        @click="openRail('rightRail')"
      />
      <v-list-item
        :title="$t('app.pluginPanelShowFloating')"
        prepend-icon="mdi-open-in-new"
        @click="restoreFloating"
      />
    </v-list>
  </v-menu>
</template>

<style scoped>
.plugin-panel-toggle {
  color: rgba(var(--v-theme-on-surface), 0.58);
}

.plugin-panel-toggle:hover {
  color: rgb(var(--v-theme-primary));
}
</style>
