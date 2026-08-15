<script setup lang="ts">
import HybridFtsSwitchDialog from '@/components/settings/HybridFtsSwitchDialog.vue'
import {
  HYBRID_FTS_PROFILES,
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
  saving?: boolean
  rebuilding?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', value: HybridFtsSettings | null): void
  (e: 'rebuild'): void
}>()

const { t } = useI18n()
const switchOpen = ref(false)
const pendingProfile = ref<HybridFtsProfile>(props.globalSettings.profile)

const followsGlobal = computed(() => props.modelValue == null)
const effective = computed(() =>
  resolveEffectiveHybridFtsSettings(props.globalSettings, props.modelValue),
)
const effectiveSpec = computed(() => formatHybridFtsSpec(effective.value))

const modeItems = computed(() => [
  { value: 'global', title: t('settings.hybridFtsAsset.followGlobal') },
  { value: 'override', title: t('settings.hybridFtsAsset.independent') },
])
const profileItems = computed(() =>
  HYBRID_FTS_PROFILES.map((value) => ({
    value,
    title: t(`settings.hybridFtsProfile.${value}`),
  })),
)

watch(
  () => props.saving,
  (saving, wasSaving) => {
    if (wasSaving && !saving && switchOpen.value) switchOpen.value = false
  },
)

function setMode(mode: string): void {
  if (mode === 'global') {
    if (!followsGlobal.value) emit('change', null)
    return
  }
  if (mode !== 'override') return
  pendingProfile.value = effective.value.profile
  switchOpen.value = true
}

function pickProfile(profile: HybridFtsProfile): void {
  pendingProfile.value = profile
  switchOpen.value = true
}

function openManageDict(): void {
  if (followsGlobal.value) return
  pendingProfile.value = effective.value.profile
  switchOpen.value = true
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
        :color="stale ? 'warning' : 'success'"
        size="small"
        variant="tonal"
      >
        {{
          stale
            ? $t('settings.hybridFtsAsset.stale')
            : $t('settings.hybridFtsAsset.current')
        }}
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

    <v-select
      v-if="!followsGlobal"
      class="mt-2"
      :model-value="effective.profile"
      :items="profileItems"
      density="compact"
      variant="outlined"
      hide-details
      :disabled="saving || rebuilding"
      @update:model-value="pickProfile"
    />

    <div
      v-if="!followsGlobal && profileRequiresDict(effective.profile)"
      class="mt-2"
    >
      <div
        v-if="effective.dictVariant"
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
        prepend-icon="mdi-book-open-variant-outline"
        :disabled="saving || rebuilding"
        @click="openManageDict"
      >
        {{ $t('settings.hybridFtsManageDict') }}
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
          <span v-else class="text-medium-emphasis">
            {{ $t('settings.hybridFtsAsset.notBuilt') }}
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
      :close-on-confirm="false"
      :confirming="!!saving"
      @confirm="confirmOverride"
    />
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
