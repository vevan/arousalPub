<script setup lang="ts">
import {
  defaultGroupChatSettings,
  DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
  DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
  normalizeGroupChatSettings,
  type GroupChatSettings,
  type SpeakerMode,
} from '@/utils/group-chat-settings'
import { characterNameById } from '@/utils/group-chat-turn'
import { useAuthStore } from '@/stores/auth'
import { characterImageUrl } from '@/utils/authenticated-media-url'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: boolean
  conversationId: string
  characterIds: string[]
  characterNames: string[]
  groupChat: GroupChatSettings
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', open: boolean): void
  (e: 'saved', payload: { groupChat: GroupChatSettings; characterIds: string[] }): void
}>()

const { t } = useI18n()
const auth = useAuthStore()

const ownerUserId = computed(() => auth.user?.id ?? auth.defaultUserId)

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const draftSettings = ref<GroupChatSettings>(defaultGroupChatSettings())
const draftCharacterIds = ref<string[]>([])
const saving = ref(false)
const errorText = ref('')

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) return
    errorText.value = ''
    draftSettings.value = normalizeGroupChatSettings(props.groupChat)
    draftCharacterIds.value = [...props.characterIds]
  },
)

const canSave = computed(() => draftCharacterIds.value.length >= 2)

const speakerMode = computed(
  (): SpeakerMode => draftSettings.value.speakerMode ?? 'dice',
)
const groupChatUiEnabled = computed(() => draftSettings.value.enabled === true)
const showGroupAssembleInstruction = computed(() => groupChatUiEnabled.value)
const showContinueAssembleInstruction = computed(
  () => groupChatUiEnabled.value && speakerMode.value === 'next@',
)
const showDecaySettings = computed(
  () =>
    groupChatUiEnabled.value &&
    (speakerMode.value === 'dice' || speakerMode.value === 'next@'),
)
const showMemberWeight = computed(
  () =>
    groupChatUiEnabled.value &&
    (speakerMode.value === 'dice' || speakerMode.value === 'next@'),
)
const showMemberOrder = computed(
  () => groupChatUiEnabled.value && speakerMode.value === 'sequential',
)

function displayName(id: string): string {
  return characterNameById(id, props.characterIds, props.characterNames)
}

function memberAvatarSrc(id: string): string | null {
  return characterImageUrl(ownerUserId.value, id, { size: 's' })
}

function memberWeight(id: string): number {
  return draftSettings.value.members?.[id]?.weight ?? 1
}

function memberMuted(id: string): boolean {
  return draftSettings.value.members?.[id]?.muted === true
}

function memberSpeakQuota(id: string): number {
  return (
    draftSettings.value.members?.[id]?.speakQuota ??
    draftSettings.value.defaultSpeakQuota ??
    2
  )
}

function setMemberSpeakQuota(id: string, speakQuota: number) {
  const members = { ...(draftSettings.value.members ?? {}) }
  members[id] = {
    ...members[id],
    speakQuota: Math.max(0, Math.round(speakQuota)),
  }
  draftSettings.value = { ...draftSettings.value, members }
}

function setMemberWeight(id: string, weight: number) {
  const members = { ...(draftSettings.value.members ?? {}) }
  members[id] = { ...members[id], weight: Math.max(0, weight) }
  draftSettings.value = { ...draftSettings.value, members }
}

function setMemberMuted(id: string, muted: boolean) {
  const members = { ...(draftSettings.value.members ?? {}) }
  members[id] = { ...members[id], muted }
  draftSettings.value = { ...draftSettings.value, members }
}

function moveMember(index: number, delta: number) {
  const next = [...draftCharacterIds.value]
  const target = index + delta
  if (target < 0 || target >= next.length) return
  const tmp = next[index]!
  next[index] = next[target]!
  next[target] = tmp
  draftCharacterIds.value = next
}

function resetGroupAssembleInstruction() {
  draftSettings.value = {
    ...draftSettings.value,
    groupAssembleInstruction: DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
  }
}

function resetContinueAssembleInstruction() {
  draftSettings.value = {
    ...draftSettings.value,
    continueAssembleInstruction: DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
  }
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  errorText.value = ''
  try {
    const res = await fetch(`/api/chat/conversations/${props.conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupChat: draftSettings.value,
        characterIds: draftCharacterIds.value,
      }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt.slice(0, 200))
    }
    const j = (await res.json()) as { index?: Record<string, unknown> }
    const savedGroupChat = j.index
      ? normalizeGroupChatSettings(j.index.groupChat)
      : draftSettings.value
    const savedCharIds = j.index && Array.isArray(j.index.characterIds)
      ? (j.index.characterIds as string[]).filter(
          (x): x is string => typeof x === 'string' && x.trim().length > 0,
        )
      : [...draftCharacterIds.value]
    emit('saved', { groupChat: savedGroupChat, characterIds: savedCharIds })
    open.value = false
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.groupChat.settings.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="36rem"
    scrollable
  >
    <v-card>
      <v-card-title>{{ $t('chat.groupChat.settings.title') }}</v-card-title>
      <v-card-subtitle class="text-wrap">
        {{ $t('chat.groupChat.settings.subtitle') }}
      </v-card-subtitle>
      <v-card-text>
        <v-alert
          v-if="!canSave"
          type="info"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          {{ $t('chat.groupChat.settings.needMultiChar') }}
        </v-alert>
        <v-alert
          v-if="errorText"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          {{ errorText }}
        </v-alert>

        <v-switch
          v-model="draftSettings.enabled"
          :label="$t('chat.groupChat.settings.enabled')"
          color="primary"
          hide-details="auto"
          class="mb-3"
        />
        <v-switch
          v-model="draftSettings.autoContinue"
          :disabled="!draftSettings.enabled"
          :label="$t('chat.groupChat.settings.autoContinue')"
          color="primary"
          hide-details="auto"
          class="mb-3"
        />
        <v-switch
          v-model="draftSettings.confirmContinue"
          :disabled="!draftSettings.enabled"
          :label="$t('chat.groupChat.settings.confirmContinue')"
          color="primary"
          hide-details="auto"
          class="mb-4"
        />

        <div class="text-subtitle-2 mb-2">
          {{ $t('chat.groupChat.settings.mode') }}
        </div>
        <v-btn-toggle
          v-model="draftSettings.speakerMode"
          :disabled="!draftSettings.enabled"
          mandatory
          density="compact"
          class="mb-4"
        >
          <v-btn value="sequential" size="small">
            {{ $t('chat.groupChat.settings.modeSequential') }}
          </v-btn>
          <v-btn value="dice" size="small">
            {{ $t('chat.groupChat.settings.modeDice') }}
          </v-btn>
          <v-btn value="next@" size="small">
            {{ $t('chat.groupChat.settings.modeNextAt') }}
          </v-btn>
        </v-btn-toggle>

        <template v-if="showGroupAssembleInstruction">
          <div class="text-subtitle-2 mb-2">
            {{ $t('chat.groupChat.settings.groupAssembleInstruction') }}
          </div>
          <v-textarea
            v-model="draftSettings.groupAssembleInstruction"
            :disabled="!draftSettings.enabled"
            :label="$t('chat.groupChat.settings.groupAssembleInstruction')"
            :hint="$t('chat.groupChat.settings.groupAssembleInstructionHint')"
            persistent-hint
            auto-grow
            rows="3"
            density="compact"
            class="mb-2"
          />
          <v-btn
            variant="text"
            size="small"
            :disabled="!draftSettings.enabled"
            class="mb-4 px-0"
            @click="resetGroupAssembleInstruction()"
          >
            {{ $t('chat.groupChat.settings.groupAssembleInstructionReset') }}
          </v-btn>
        </template>

        <template v-if="showContinueAssembleInstruction">
          <div class="text-subtitle-2 mb-2">
            {{ $t('chat.groupChat.settings.continueAssembleInstruction') }}
          </div>
          <v-textarea
            v-model="draftSettings.continueAssembleInstruction"
            :disabled="!draftSettings.enabled"
            :label="$t('chat.groupChat.settings.continueAssembleInstruction')"
            :hint="$t('chat.groupChat.settings.continueAssembleInstructionHint')"
            persistent-hint
            auto-grow
            rows="3"
            density="compact"
            class="mb-2"
          />
          <v-btn
            variant="text"
            size="small"
            :disabled="!draftSettings.enabled"
            class="mb-4 px-0"
            @click="resetContinueAssembleInstruction()"
          >
            {{ $t('chat.groupChat.settings.continueAssembleInstructionReset') }}
          </v-btn>
        </template>

        <div class="group-chat-num-grid group-chat-num-grid--2 mb-4">
          <div class="group-chat-num-item">
            <div class="text-caption text-medium-emphasis mb-1">
              {{ $t('chat.groupChat.settings.maxSegmentsPerTurn') }}
            </div>
            <v-text-field
              v-model.number="draftSettings.maxSegmentsPerTurn"
              :disabled="!draftSettings.enabled"
              type="number"
              min="1"
              step="1"
              density="compact"
              hide-details="auto"
            />
          </div>
          <div class="group-chat-num-item">
            <div class="text-caption text-medium-emphasis mb-1">
              {{ $t('chat.groupChat.settings.defaultSpeakQuota') }}
            </div>
            <v-text-field
              v-model.number="draftSettings.defaultSpeakQuota"
              :disabled="!draftSettings.enabled"
              type="number"
              min="1"
              step="1"
              density="compact"
              hide-details="auto"
            />
          </div>
        </div>

        <template v-if="showDecaySettings">
          <div class="text-subtitle-2 mb-2">
            {{ $t('chat.groupChat.settings.decay') }}
          </div>
          <v-switch
            v-model="draftSettings.decay!.enabled"
            :disabled="!draftSettings.enabled"
            :label="$t('chat.groupChat.settings.decayEnabled')"
            color="primary"
            hide-details="auto"
            class="mb-2"
          />
          <div class="group-chat-num-grid group-chat-num-grid--3 mb-4">
            <div class="group-chat-num-item">
              <div class="text-caption text-medium-emphasis mb-1">
                {{ $t('chat.groupChat.settings.decayInitial') }}
              </div>
              <v-text-field
                v-model.number="draftSettings.decay!.initialRate"
                :disabled="!draftSettings.enabled"
                type="number"
                min="0"
                max="1"
                step="0.05"
                density="compact"
                hide-details="auto"
              />
            </div>
            <div class="group-chat-num-item">
              <div class="text-caption text-medium-emphasis mb-1">
                {{ $t('chat.groupChat.settings.decayStep') }}
              </div>
              <v-text-field
                v-model.number="draftSettings.decay!.step"
                :disabled="!draftSettings.enabled"
                type="number"
                min="0"
                max="1"
                step="0.05"
                density="compact"
                hide-details="auto"
              />
            </div>
            <div class="group-chat-num-item">
              <div class="text-caption text-medium-emphasis mb-1">
                {{ $t('chat.groupChat.settings.decayFloor') }}
              </div>
              <v-text-field
                v-model.number="draftSettings.decay!.floor"
                :disabled="!draftSettings.enabled"
                type="number"
                min="0"
                max="1"
                step="0.05"
                density="compact"
                hide-details="auto"
              />
            </div>
          </div>
        </template>

        <div class="text-subtitle-2 mb-2">
          {{ $t('chat.groupChat.settings.members') }}
        </div>
        <div
          v-for="(id, index) in draftCharacterIds"
          :key="id"
          class="group-chat-member-row"
        >
          <div class="group-chat-member-row__identity">
            <v-avatar
              size="36"
              rounded="sm"
              class="group-chat-member-row__avatar"
              :aria-label="displayName(id)"
            >
              <v-img
                v-if="memberAvatarSrc(id)"
                :src="memberAvatarSrc(id) ?? undefined"
                cover
              />
              <v-icon v-else size="20" aria-hidden="true">mdi-account</v-icon>
            </v-avatar>
            <span class="group-chat-member-row__name">{{ displayName(id) }}</span>
          </div>
          <div v-if="showMemberWeight" class="group-chat-num-item group-chat-num-item--member">
            <div class="text-caption text-medium-emphasis mb-1">
              {{ $t('chat.groupChat.settings.weight') }}
            </div>
            <v-text-field
              :model-value="memberWeight(id)"
              :disabled="!draftSettings.enabled"
              type="number"
              min="0"
              step="0.1"
              density="compact"
              hide-details="auto"
              @update:model-value="(v) => setMemberWeight(id, Number(v))"
            />
          </div>
          <div class="group-chat-num-item group-chat-num-item--member">
            <div class="text-caption text-medium-emphasis mb-1">
              {{ $t('chat.groupChat.settings.speakQuota') }}
            </div>
            <v-text-field
              :model-value="memberSpeakQuota(id)"
              :disabled="!draftSettings.enabled"
              type="number"
              min="0"
              step="1"
              density="compact"
              hide-details="auto"
              @update:model-value="(v) => setMemberSpeakQuota(id, Number(v))"
            />
          </div>
          <v-switch
            :model-value="memberMuted(id)"
            :disabled="!draftSettings.enabled"
            :label="$t('chat.groupChat.settings.muted')"
            color="primary"
            density="compact"
            hide-details="auto"
            @update:model-value="(v) => setMemberMuted(id, Boolean(v))"
          />
          <div v-if="showMemberOrder" class="group-chat-member-row__order">
            <v-btn
              icon="mdi-chevron-up"
              size="x-small"
              variant="text"
              :disabled="!draftSettings.enabled || index === 0"
              @click="moveMember(index, -1)"
            />
            <v-btn
              icon="mdi-chevron-down"
              size="x-small"
              variant="text"
              :disabled="!draftSettings.enabled || index === draftCharacterIds.length - 1"
              @click="moveMember(index, 1)"
            />
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">
          {{ $t('settings.themeCancel') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="!canSave"
          @click="save()"
        >
          {{ $t('settings.themeConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.group-chat-member-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.08);
}
.group-chat-member-row__identity {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1 1 8rem;
  min-width: 0;
}
.group-chat-member-row__avatar {
  flex: 0 0 auto;
}
.group-chat-member-row__name {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-chat-member-row__order {
  display: flex;
  gap: 0.125rem;
}
.group-chat-num-grid {
  display: grid;
  gap: 0.75rem 1rem;
}
.group-chat-num-grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.group-chat-num-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.group-chat-num-item--member {
  flex: 0 1 5.5rem;
  min-width: 4.5rem;
}
@media (max-width: 30rem) {
  .group-chat-num-grid--2,
  .group-chat-num-grid--3 {
    grid-template-columns: 1fr;
  }
}
</style>
