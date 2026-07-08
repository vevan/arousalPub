<script setup lang="ts">
import {
  clampInjectionOrder,
  INJECTION_ORDER_MAX,
  INJECTION_ORDER_MIN,
  POST_USER_INJECTION_ORDER_HOST_DEFAULTS,
  type PostUserInjectionOrderHostKey,
} from '@/utils/post-user-injection-order'
import { usePreferencesStore } from '@/stores/preferences'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    fieldKey: PostUserInjectionOrderHostKey
    disabled?: boolean
    density?: 'default' | 'comfortable' | 'compact'
  }>(),
  { density: 'comfortable' },
)

const { t } = useI18n()
const prefStore = usePreferencesStore()
const { postUserInjectionOrderHostPolicy } = storeToRefs(prefStore)

const model = computed({
  get: () => postUserInjectionOrderHostPolicy.value[props.fieldKey],
  set: (raw: unknown) => {
    const num = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(num)) return
    const next = clampInjectionOrder(num)
    if (postUserInjectionOrderHostPolicy.value[props.fieldKey] === next) return
    postUserInjectionOrderHostPolicy.value = {
      ...postUserInjectionOrderHostPolicy.value,
      [props.fieldKey]: next,
    }
  },
})

const label = computed(() =>
  t(`settings.injectionOrderField.${props.fieldKey}.label`),
)
const hint = computed(() =>
  t(`settings.injectionOrderField.${props.fieldKey}.hint`, {
    default: POST_USER_INJECTION_ORDER_HOST_DEFAULTS[props.fieldKey],
  }),
)
</script>

<template>
  <v-text-field
    v-model.number="model"
    type="number"
    :min="INJECTION_ORDER_MIN"
    :max="INJECTION_ORDER_MAX"
    step="1"
    :density="density"
    variant="outlined"
    hide-details="auto"
    :label="label"
    :hint="hint"
    persistent-hint
    :disabled="disabled"
  />
</template>
