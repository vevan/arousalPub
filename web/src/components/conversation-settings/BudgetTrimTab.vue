<script setup lang="ts">
import BudgetTrimSettingsPanel from '@/components/settings/BudgetTrimSettingsPanel.vue'
import type { BudgetTrimSettings } from '@/utils/budget-trim-settings'
import '@/components/conversation-settings/conversation-settings-fields.css'

const budgetTrimUseGlobal = defineModel<boolean>('budgetTrimUseGlobal', { required: true })
const budgetTrimModel = defineModel<BudgetTrimSettings>('budgetTrimModel', { required: true })

defineProps<{
  savingBudgetTrimSettings: boolean
}>()
</script>

<template>
  <div class="conv-settings-section">
    <div class="conv-settings-field">
                    <v-switch
                      v-model="budgetTrimUseGlobal"
                      :label="$t('chat.convSettings.budgetTrimUseGlobal')"
                      density="comfortable"
                      hide-details
                      color="primary"
                      :loading="savingBudgetTrimSettings"
                      :disabled="savingBudgetTrimSettings"
                    />
                    <p
                      v-if="budgetTrimUseGlobal"
                      class="conv-settings-field__hint"
                    >
                      {{ $t('chat.convSettings.budgetTrimInheritGlobalHint') }}
                    </p>
                  </div>
                  <BudgetTrimSettingsPanel
                    v-model="budgetTrimModel"
                    :disabled="budgetTrimUseGlobal || savingBudgetTrimSettings"
                  />
  </div>
</template>
