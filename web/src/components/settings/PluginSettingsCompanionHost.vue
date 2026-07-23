<script setup lang="ts">
import { PLUGIN_HOST_KEY } from '@/plugins/injection'
import {
  getSettingsCompanionPanel,
  settingsCompanionRevision,
} from '@/plugins/plugin-settings-companion-registry'
import { computed, inject, onMounted, watch } from 'vue'

const props = defineProps<{
  companionPanel: string
  pluginId: string
  conversationId: string
  convModel?: Record<string, unknown>
  globalModel?: Record<string, unknown>
}>()

const pluginHost = inject(PLUGIN_HOST_KEY, null)

onMounted(() => {
  void pluginHost?.ensurePluginById(props.pluginId)
})

watch(
  () => props.pluginId,
  (id) => {
    void pluginHost?.ensurePluginById(id)
  },
)

const view = computed(() => {
  const panelId = props.companionPanel.trim()
  if (!panelId) return null
  void settingsCompanionRevision.value
  const def = getSettingsCompanionPanel(props.pluginId, panelId)
  if (!def) return null
  return def.getView({
    conversationId: props.conversationId,
    convModel: props.convModel ?? {},
    globalModel: props.globalModel ?? {},
  })
})
</script>

<template>
  <div
    v-if="view"
    class="plugin-settings-companion"
  >
    <div class="plugin-settings-companion__body">
      <div class="plugin-settings-companion__title text-caption font-weight-medium">
        {{ view.title }}
      </div>

      <div
        v-for="(row, i) in view.rows"
        :key="i"
        class="plugin-settings-companion__row"
        :class="{
          'plugin-settings-companion__row--muted': row.tone === 'muted',
          'plugin-settings-companion__row--accent': row.tone === 'accent',
        }"
      >
        <v-icon
          :icon="row.icon"
          size="16"
          class="plugin-settings-companion__row-icon"
        />
        <span class="plugin-settings-companion__row-text">{{ row.text }}</span>
      </div>
    </div>

    <template v-if="view.actionLabel && view.onAction">
      <v-divider class="plugin-settings-companion__divider" />
      <v-btn
        variant="outlined"
        size="small"
        color="primary"
        prepend-icon="mdi-tune-vertical"
        class="plugin-settings-companion__action-btn text-none"
        block
        @click="view.onAction"
      >
        {{ view.actionLabel }}
      </v-btn>
    </template>
  </div>
</template>

<style scoped>
.plugin-settings-companion {
  --plugin-companion-icon-col: 20px;
  --plugin-companion-row-gap: 8px;

  margin-top: 10px;
  margin-bottom: 4px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-border-color), calc(var(--v-border-opacity) * 1.2));
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.plugin-settings-companion__body {
  display: grid;
  grid-template-columns: var(--plugin-companion-icon-col) 1fr;
  column-gap: var(--plugin-companion-row-gap);
  row-gap: var(--plugin-companion-row-gap);
  align-items: start;
}

.plugin-settings-companion__title {
  grid-column: 1 / -1;
}

.plugin-settings-companion__row {
  display: contents;
}

.plugin-settings-companion__row-icon {
  margin-top: 2px;
}

.plugin-settings-companion__row-text {
  line-height: 1.35;
}

.plugin-settings-companion__row--muted .plugin-settings-companion__row-text {
  opacity: 0.7;
}

.plugin-settings-companion__row--accent .plugin-settings-companion__row-text {
  color: rgb(var(--v-theme-primary));
}

.plugin-settings-companion__divider {
  margin: 12px 0;
}

.plugin-settings-companion__action-btn {
  letter-spacing: normal;
}
</style>
