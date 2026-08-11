<script setup lang="ts">
import '@/components/conversation-settings/conversation-settings-fields.css'

const historyUseGlobal = defineModel<boolean>('historyUseGlobal', { required: true })
const historyLimitEnabled = defineModel<boolean>('historyLimitEnabled', { required: true })
const historyMaxTurns = defineModel<number>('historyMaxTurns', { required: true })

defineProps<{
  savingHistorySettings: boolean
}>()
</script>

<template>
  <div class="conv-settings-section">
    <div class="conv-settings-subsection">
                    <h4 class="conv-settings-subsection__title">
                      {{ $t('chat.convSettings.sectionHistory') }}
                    </h4>
                    <div class="conv-settings-field">
                      <v-switch
                        v-model="historyUseGlobal"
                        :label="$t('chat.convSettings.historyUseGlobal')"
                        density="comfortable"
                        hide-details
                        color="primary"
                        :loading="savingHistorySettings"
                        :disabled="savingHistorySettings"
                      />
                      <p
                        v-if="historyUseGlobal"
                        class="conv-settings-field__hint"
                      >
                        {{ $t('chat.convSettings.historyInheritGlobalHint') }}
                      </p>
                    </div>
                    <div class="conv-settings-field">
                      <v-switch
                        v-model="historyLimitEnabled"
                        :label="$t('chat.convSettings.historyLimitEnabled')"
                        density="comfortable"
                        hide-details
                        color="primary"
                        :loading="savingHistorySettings"
                        :disabled="historyUseGlobal || savingHistorySettings"
                      />
                      <p class="conv-settings-field__hint">
                        {{ $t('chat.convSettings.historyLimitHint') }}
                      </p>
                    </div>
                    <div class="conv-settings-field">
                      <v-text-field
                        v-model.number="historyMaxTurns"
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        :label="$t('chat.convSettings.historyMaxTurns')"
                        density="comfortable"
                        variant="outlined"
                        hide-details="auto"
                        :disabled="historyUseGlobal || !historyLimitEnabled || savingHistorySettings"
                        :loading="savingHistorySettings"
                      />
                      <p
                        v-if="historyLimitEnabled"
                        class="conv-settings-field__hint"
                      >
                        {{ $t('chat.convSettings.historyMaxTurnsHint') }}
                      </p>
                    </div>
                  </div>
  </div>
</template>
