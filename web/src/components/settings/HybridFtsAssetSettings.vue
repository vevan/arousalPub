<script setup lang="ts">
import HybridFtsSwitchDialog from '@/components/settings/HybridFtsSwitchDialog.vue'
import {
  formatHybridFtsSpec,
  profileRequiresDict,
  resolveEffectiveHybridFtsSettings,
  type HybridFtsDictVariant,
  type HybridFtsProfile,
  type HybridFtsSettings,
} from '@/utils/hybrid-fts-settings'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue?: HybridFtsSettings | null
  globalSettings: HybridFtsSettings
  builtSpec?: string | null
  stale?: boolean
  /** false：当前资产没有可建索引内容，built 为空属正常 */
  indexApplicable?: boolean
  saving?: boolean
  rebuilding?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', value: HybridFtsSettings | null): void
  (e: 'rebuild'): void
}>()

const { t } = useI18n()
const switchOpen = ref(false)
const followGlobalConfirmOpen = ref(false)
const pendingProfile = ref<HybridFtsProfile>(props.globalSettings.profile)

const followsGlobal = computed(() => props.modelValue == null)
const indexApplicable = computed(() => props.indexApplicable !== false)
const effective = computed(() =>
  resolveEffectiveHybridFtsSettings(props.globalSettings, props.modelValue),
)
const effectiveSpec = computed(() => formatHybridFtsSpec(effective.value))
const globalSpec = computed(() => formatHybridFtsSpec(props.globalSettings))
const statusChip = computed(() => {
  if (props.stale) {
    return {
      color: 'warning' as const,
      label: t('settings.hybridFtsAsset.stale'),
    }
  }
  if (!indexApplicable.value && !props.builtSpec?.trim()) {
    return {
      color: 'default' as const,
      label: t('settings.hybridFtsAsset.notNeeded'),
    }
  }
  return {
    color: 'success' as const,
    label: t('settings.hybridFtsAsset.current'),
  }
})
const builtLabel = computed(() => {
  if (props.builtSpec?.trim()) return null
  return indexApplicable.value
    ? t('settings.hybridFtsAsset.notBuilt')
    : t('settings.hybridFtsAsset.notNeeded')
})

const modeItems = computed(() => [
  { value: 'global', title: t('settings.hybridFtsAsset.followGlobal') },
  { value: 'override', title: t('settings.hybridFtsAsset.independent') },
])

watch(
  () => props.saving,
  (saving, wasSaving) => {
    if (!(wasSaving && !saving)) return
    if (switchOpen.value) switchOpen.value = false
    if (followGlobalConfirmOpen.value) followGlobalConfirmOpen.value = false
  },
)

function setMode(mode: string): void {
  if (mode === 'global') {
    if (followsGlobal.value || props.saving || props.rebuilding) return
    followGlobalConfirmOpen.value = true
    return
  }
  if (mode !== 'override') return
  openSwitchDialog()
}

/** 分词器与词典规格统一在弹窗内选择 */
function openSwitchDialog(): void {
  pendingProfile.value = effective.value.profile
  switchOpen.value = true
}

function confirmFollowGlobal(): void {
  if (props.saving || props.rebuilding) return
  emit('change', null)
}

function cancelFollowGlobal(): void {
  if (props.saving) return
  followGlobalConfirmOpen.value = false
}

function confirmOverride(payload: {
  profile: HybridFtsProfile
  dictVariant: HybridFtsDictVariant | null
}): void {
  emit('change', payload)
}
</script>

<template>
  <v-sheet
    class="hybrid-fts-asset pa-3"
    rounded="lg"
    border
  >
    <div class="d-flex align-center justify-space-between ga-3 mb-2">
      <div>
        <div class="text-subtitle-2">
          {{ $t('settings.hybridFtsAsset.title') }}
        </div>
        <div class="text-caption text-medium-emphasis">
          {{ $t('settings.hybridFtsAsset.hint') }}
        </div>
      </div>
      <v-chip
        :color="statusChip.color"
        size="small"
        variant="tonal"
      >
        {{ statusChip.label }}
      </v-chip>
    </div>

    <v-select
      :model-value="followsGlobal ? 'global' : 'override'"
      :items="modeItems"
      density="compact"
      variant="outlined"
      hide-details
      :disabled="saving || rebuilding"
      @update:model-value="(value: string) => setMode(value as 'global' | 'override')"
    />

    <div
      v-if="!followsGlobal"
      class="mt-2"
    >
      <div
        v-if="profileRequiresDict(effective.profile) && effective.dictVariant"
        class="text-body-2"
      >
        {{ $t('settings.hybridFtsCurrentDict') }}:
        <strong>
          {{ $t(`settings.hybridFtsDictVariant.${effective.dictVariant}`) }}
        </strong>
      </div>
      <v-btn
        class="mt-2"
        size="small"
        variant="outlined"
        color="primary"
        prepend-icon="mdi-tune-variant"
        :disabled="saving || rebuilding"
        @click="openSwitchDialog"
      >
        {{ $t('settings.hybridFtsAsset.changeTokenizer') }}
      </v-btn>
    </div>

    <dl class="hybrid-fts-asset__status mt-3 mb-0">
      <div>
        <dt>{{ $t('settings.hybridFtsAsset.effective') }}</dt>
        <dd>
          <span class="text-medium-emphasis">
            {{
              followsGlobal
                ? $t('settings.hybridFtsAsset.sourceGlobal')
                : $t('settings.hybridFtsAsset.sourceIndependent')
            }}
            ·
          </span>
          <code>{{ effectiveSpec }}</code>
        </dd>
      </div>
      <div>
        <dt>{{ $t('settings.hybridFtsAsset.built') }}</dt>
        <dd>
          <code v-if="builtSpec">{{ builtSpec }}</code>
          <span
            v-else
            class="text-medium-emphasis"
          >
            {{ builtLabel }}
          </span>
        </dd>
      </div>
    </dl>

    <div class="d-flex justify-end mt-3">
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-database-refresh-outline"
        :loading="rebuilding"
        :disabled="saving || rebuilding"
        @click="emit('rebuild')"
      >
        {{ $t('settings.hybridFtsAsset.rebuildCurrent') }}
      </v-btn>
    </div>

    <HybridFtsSwitchDialog
      v-model="switchOpen"
      :pending-profile="pendingProfile"
      :current-profile="effective.profile"
      :current-dict-variant="effective.dictVariant ?? null"
      title-key="settings.hybridFtsAsset.dialogTitle"
      warning-key="settings.hybridFtsAsset.rebuildWarning"
      confirm-key="settings.hybridFtsAsset.applyAndRebuild"
      profile-selectable
      :close-on-confirm="false"
      :confirming="!!saving"
      @confirm="confirmOverride"
    />

    <v-dialog
      v-model="followGlobalConfirmOpen"
      max-width="480"
      :persistent="!!saving"
    >
      <v-card>
        <v-card-title class="text-h6">
          {{ $t('settings.hybridFtsAsset.followGlobalTitle') }}
        </v-card-title>
        <v-card-text>
          <v-alert
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            {{ $t('settings.hybridFtsAsset.followGlobalWarning') }}
          </v-alert>
          <div class="text-body-2">
            {{ $t('settings.hybridFtsAsset.followGlobalTarget') }}:
            <code>{{ globalSpec }}</code>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="!!saving"
            @click="cancelFollowGlobal"
          >
            {{ $t('settings.hybridFtsSwitch.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="!!saving"
            @click="confirmFollowGlobal"
          >
            {{ $t('settings.hybridFtsAsset.applyAndRebuild') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-sheet>
</template>

<style scoped>
.hybrid-fts-asset__status {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.8125rem;
}

.hybrid-fts-asset__status > div {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr);
  gap: 0.5rem;
}

.hybrid-fts-asset__status dt {
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.hybrid-fts-asset__status dd {
  margin: 0;
  min-width: 0;
  word-break: break-word;
}
</style>
