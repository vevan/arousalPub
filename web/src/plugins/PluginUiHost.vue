<script setup lang="ts">
import {
  clearPluginSnackbar,
  pluginConfirmOpen,
  pluginProgressOpen,
  pluginSnackbar,
  resolvePluginConfirm,
} from '@/plugins/plugin-ui-state'
import { computed } from 'vue'

const confirmOpen = computed({
  get: () => pluginConfirmOpen.value != null,
  set: (v: boolean) => {
    if (!v) resolvePluginConfirm(false)
  },
})

const confirmState = computed(() => pluginConfirmOpen.value)

const snackbarOpen = computed({
  get: () => pluginSnackbar.value != null,
  set: (v: boolean) => {
    if (!v) clearPluginSnackbar()
  },
})

const snackbarMessage = computed(() => pluginSnackbar.value?.message ?? '')
const snackbarColor = computed(() => pluginSnackbar.value?.color ?? 'surface-variant')
const snackbarTimeout = computed(() => pluginSnackbar.value?.timeout ?? 4000)

const progressState = computed(() => pluginProgressOpen.value)

const progressPercent = computed(() => {
  const p = progressState.value
  if (!p || p.total <= 0) return 0
  return Math.min(100, Math.round((p.done / p.total) * 100))
})
</script>

<template>
  <v-dialog
    v-model="confirmOpen"
    max-width="480"
    @click:outside="resolvePluginConfirm(false)"
  >
    <v-card v-if="confirmState">
      <v-card-title class="text-h6">
        {{ confirmState.title }}
      </v-card-title>
      <v-card-text class="text-pre-wrap">
        {{ confirmState.body }}
      </v-card-text>
      <v-card-actions class="pa-3">
        <v-spacer />
        <v-btn
          variant="text"
          @click="resolvePluginConfirm(false)"
        >
          {{ confirmState.cancelLabel }}
        </v-btn>
        <v-btn
          :color="confirmState.confirmColor"
          variant="flat"
          @click="resolvePluginConfirm(true)"
        >
          {{ confirmState.confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="progressState != null"
    persistent
    max-width="28rem"
  >
    <v-card v-if="progressState">
      <v-card-title class="text-body-1 font-weight-medium">
        {{ progressState.message }}
      </v-card-title>
      <v-card-text>
        <v-progress-linear
          :model-value="progressPercent"
          color="primary"
          height="8"
          rounded
          class="mb-2"
        />
        <div class="text-body-2 text-medium-emphasis">
          {{ progressState.done }} / {{ progressState.total }}
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-snackbar
    v-model="snackbarOpen"
    :color="snackbarColor"
    :timeout="snackbarTimeout"
    location="bottom"
  >
    {{ snackbarMessage }}
  </v-snackbar>
</template>
