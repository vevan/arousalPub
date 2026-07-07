<script setup lang="ts">
import { patchConversationPluginSettings } from '@/plugins/plugin-host-api'
import {
  buildAutoSummarizePointerResetPatch,
  computeAutoSummarizeProgress,
  readLastSummarizedEnd,
} from '@/utils/plot-summary-auto-summarize-status'
import { fetchConversationTurns } from '@/utils/chat-messages'
import { translatePluginI18nKey } from '@/utils/plugin-locale-text'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const PLUGIN_ID = 'plot-summary'

const props = defineProps<{
  conversationId: string
  convModel?: Record<string, unknown>
  globalModel?: Record<string, unknown>
}>()

const emit = defineEmits<{
  (e: 'error', message: string): void
}>()

const { t, te } = useI18n()

const dialogOpen = ref(false)
const saving = ref(false)
const loadingMax = ref(false)
const maxTurnOrdinal = ref<number | null>(null)
const endTurnInput = ref('')
const neverMode = ref(false)

function pluginT(key: string, params?: Record<string, unknown>): string {
  const fullKey = `plugins.${PLUGIN_ID}.${key}`
  const text = translatePluginI18nKey(fullKey, t, te, params)
  if (!text.startsWith('plugins.')) return text
  if (key === 'convAutoSummarizeProgressTitle') {
    return t('chat.convSettings.plotSummaryProgressTitle')
  }
  return text
}

const progressTitle = computed(() => pluginT('convAutoSummarizeProgressTitle'))

const progress = computed(() =>
  computeAutoSummarizeProgress(props.convModel ?? {}, props.globalModel ?? {}),
)

const statusRows = computed(() => {
  const p = progress.value
  const rows: { icon: string; text: string; tone?: 'muted' | 'accent' }[] = []

  if (p.lastSummarizedEnd !== null && p.lastSummarizedEnd >= 0) {
    rows.push({
      icon: 'mdi-check-circle-outline',
      text: pluginT('convAutoSummarizeProgressDone', { end: p.lastSummarizedEnd }),
    })
  } else {
    rows.push({
      icon: 'mdi-circle-outline',
      text: pluginT('convAutoSummarizeProgressNever'),
      tone: 'muted',
    })
  }

  rows.push({
    icon: 'mdi-format-list-bulleted',
    text: pluginT('convAutoSummarizeProgressPending', {
      from: p.pendingFromTurn,
      to: p.pendingToTurn,
    }),
  })

  if (p.autoSummarizeEnabled) {
    rows.push({
      icon: 'mdi-calendar-clock',
      text: pluginT('convAutoSummarizeProgressNext', { turn: p.nextTriggerTurn }),
      tone: 'accent',
    })
  } else {
    rows.push({
      icon: 'mdi-pause-circle-outline',
      text: pluginT('convAutoSummarizeProgressOff'),
      tone: 'muted',
    })
  }

  return rows
})

const parsedEnd = computed(() => {
  if (neverMode.value) return null
  const raw = endTurnInput.value.trim()
  if (!raw) return undefined
  const n = Math.round(Number(raw))
  return Number.isFinite(n) ? n : undefined
})

const canSubmit = computed(() => {
  if (neverMode.value) return true
  const n = parsedEnd.value
  return typeof n === 'number' && n >= -1
})

const aheadWarning = computed(() => {
  if (neverMode.value || maxTurnOrdinal.value === null) return false
  const n = parsedEnd.value
  return typeof n === 'number' && n > maxTurnOrdinal.value
})

async function loadMaxTurn() {
  loadingMax.value = true
  try {
    const turns = await fetchConversationTurns(props.conversationId)
    let max = -1
    for (const turn of turns) {
      if (typeof turn.turnOrdinal === 'number' && turn.turnOrdinal > max) {
        max = turn.turnOrdinal
      }
    }
    maxTurnOrdinal.value = max < 0 ? null : max
  } catch {
    maxTurnOrdinal.value = null
  } finally {
    loadingMax.value = false
  }
}

function initFromConv() {
  const last = props.convModel ? readLastSummarizedEnd(props.convModel) : null
  neverMode.value = last === null
  endTurnInput.value = last === null ? '' : String(last)
}

function openDialog() {
  initFromConv()
  dialogOpen.value = true
  void loadMaxTurn()
}

function applyNeverMode() {
  neverMode.value = true
  endTurnInput.value = ''
}

async function submit() {
  if (!canSubmit.value) return
  const patch = buildAutoSummarizePointerResetPatch(
    neverMode.value ? null : (parsedEnd.value as number),
  )
  saving.value = true
  try {
    await patchConversationPluginSettings(props.conversationId, PLUGIN_ID, patch)
    dialogOpen.value = false
  } catch (e) {
    emit('error', e instanceof Error ? e.message : t('chat.convSettings.saveFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="auto-summarize-status-panel">
    <div class="auto-summarize-status-panel__body">
      <div class="auto-summarize-status-panel__title text-caption font-weight-medium">
        {{ progressTitle }}
      </div>

      <div
        v-for="(row, i) in statusRows"
        :key="i"
        class="auto-summarize-status-panel__row"
        :class="{
          'auto-summarize-status-panel__row--muted': row.tone === 'muted',
          'auto-summarize-status-panel__row--accent': row.tone === 'accent',
        }"
      >
        <v-icon
          :icon="row.icon"
          size="16"
          class="auto-summarize-status-panel__row-icon"
        />
        <span class="auto-summarize-status-panel__row-text">{{ row.text }}</span>
      </div>
    </div>

    <v-divider class="auto-summarize-status-panel__divider" />

    <v-btn
      variant="outlined"
      size="small"
      color="primary"
      prepend-icon="mdi-tune-vertical"
      class="auto-summarize-status-panel__reset-btn text-none"
      block
      @click="openDialog"
    >
      {{ pluginT('convAutoSummarizeResetBtn') }}
    </v-btn>

    <v-dialog
      v-model="dialogOpen"
      max-width="440"
    >
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ pluginT('convAutoSummarizeResetTitle') }}
        </v-card-title>
        <v-card-text class="auto-summarize-reset-dialog__body">
          <p class="auto-summarize-reset-dialog__hint text-body-2 text-medium-emphasis">
            {{ pluginT('convAutoSummarizeResetHint') }}
          </p>
          <v-text-field
            v-model="endTurnInput"
            type="number"
            variant="outlined"
            density="comfortable"
            class="auto-summarize-reset-dialog__field"
            :label="pluginT('convAutoSummarizeResetEndLabel')"
            :disabled="saving"
            :hint="
              maxTurnOrdinal !== null
                ? pluginT('convAutoSummarizeResetMaxHint', { max: maxTurnOrdinal })
                : undefined
            "
            persistent-hint
            min="-1"
            hide-details="auto"
            @update:model-value="neverMode = false"
          />
          <v-alert
            v-if="aheadWarning"
            type="warning"
            variant="tonal"
            density="compact"
            class="auto-summarize-reset-dialog__alert"
          >
            {{ pluginT('convAutoSummarizeResetAheadWarn', { max: maxTurnOrdinal }) }}
          </v-alert>
          <v-btn
            variant="outlined"
            size="small"
            :color="neverMode ? 'primary' : undefined"
            prepend-icon="mdi-backspace-outline"
            class="auto-summarize-reset-dialog__never-btn text-none"
            block
            :disabled="saving"
            @click="applyNeverMode"
          >
            {{ pluginT('convAutoSummarizeResetNever') }}
          </v-btn>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="tonal"
            size="small"
            class="text-none"
            :disabled="saving"
            @click="dialogOpen = false"
          >
            {{ pluginT('sessionCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="saving"
            :disabled="!canSubmit || loadingMax"
            @click="submit"
          >
            {{ pluginT('convAutoSummarizeResetConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.auto-summarize-status-panel {
  --auto-summarize-icon-col: 20px;
  --auto-summarize-row-gap: 8px;

  margin-top: 10px;
  margin-bottom: 4px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-border-color), calc(var(--v-border-opacity) * 1.2));
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.auto-summarize-status-panel__body {
  display: grid;
  grid-template-columns: var(--auto-summarize-icon-col) 1fr;
  column-gap: var(--auto-summarize-row-gap);
  row-gap: var(--auto-summarize-row-gap);
  align-items: start;
}

.auto-summarize-status-panel__title {
  grid-column: 1 / -1;
  color: rgba(var(--v-theme-on-surface), 0.72);
  letter-spacing: 0.02em;
  margin-bottom: 2px;
}

.auto-summarize-status-panel__row {
  display: contents;
}

.auto-summarize-status-panel__row-icon {
  grid-column: 1;
  margin-top: 2px;
  opacity: 0.85;
}

.auto-summarize-status-panel__row-text {
  grid-column: 2;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.88);
}

.auto-summarize-status-panel__row--muted .auto-summarize-status-panel__row-text {
  color: rgba(var(--v-theme-on-surface), 0.58);
}

.auto-summarize-status-panel__row--accent .auto-summarize-status-panel__row-text {
  color: rgb(var(--v-theme-primary));
}

.auto-summarize-status-panel__divider {
  margin: 12px 0 10px;
  opacity: 0.35;
}

.auto-summarize-status-panel__reset-btn {
  margin-top: 2px;
}

.auto-summarize-reset-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.auto-summarize-reset-dialog__body > .auto-summarize-reset-dialog__hint {
  margin: 0;
}

.auto-summarize-reset-dialog__body > .auto-summarize-reset-dialog__field,
.auto-summarize-reset-dialog__body > .auto-summarize-reset-dialog__alert,
.auto-summarize-reset-dialog__body > .auto-summarize-reset-dialog__never-btn {
  margin: 0;
  width: 100%;
}
</style>
