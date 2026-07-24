<script setup lang="ts">
import { characterImageUrl } from '@/utils/authenticated-media-url'
import { setAtSlashDisplayName } from '@/utils/composer-at-slash-append'
import {
  groupChatMemberColor,
  isGroupChatMemberMuted,
  mergeGroupChatSettings,
  normalizeGroupChatSettings,
  type GroupChatSettings,
} from '@/utils/group-chat-settings'
import { characterNameById } from '@/utils/group-chat-turn'
import { useAuthStore } from '@/stores/auth'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  conversationId: string
  characterIds: string[]
  characterDisplayNames: string[]
  groupChat: GroupChatSettings
  userInput: string
}>()

const emit = defineEmits<{
  (e: 'update:userInput', value: string): void
  (e: 'groupChatSaved', value: GroupChatSettings): void
}>()

const { t } = useI18n()
const auth = useAuthStore()

const expandedId = ref<string | null>(null)
const muteBusyId = ref<string | null>(null)
const errorText = ref('')

const ownerUserId = computed(
  () => auth.user?.id ?? auth.defaultUserId ?? '',
)

const members = computed(() =>
  props.characterIds.map((id) => {
    const name =
      characterNameById(id, props.characterIds, props.characterDisplayNames) ||
      id
    const muted = isGroupChatMemberMuted(id, props.groupChat)
    const color = groupChatMemberColor(id, props.groupChat)
    const avatar =
      characterImageUrl(ownerUserId.value, id, { size: 's' }) ?? ''
    return { id, name, muted, color, avatar }
  }),
)

function isExpanded(id: string): boolean {
  return expandedId.value === id
}

function onRowEnter(id: string) {
  expandedId.value = id
}

function onRowLeave(id: string) {
  if (expandedId.value === id) expandedId.value = null
}

function onAvatarClick(id: string, e: MouseEvent) {
  // 触屏：无 hover 时点按 toggle；桌面点按不打断 hover 展开
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return
  }
  e.preventDefault()
  expandedId.value = expandedId.value === id ? null : id
}

function onDocPointerDown(ev: PointerEvent) {
  const el = ev.target
  if (!(el instanceof Element)) return
  if (el.closest('.composer-group-roster')) return
  expandedId.value = null
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
})

watch(
  () => props.characterIds.join('\0'),
  () => {
    expandedId.value = null
  },
)

function onAt(name: string) {
  const next = setAtSlashDisplayName(
    props.userInput,
    name,
    props.characterDisplayNames,
  )
  emit('update:userInput', next)
}

async function onToggleMute(id: string) {
  if (muteBusyId.value) return
  muteBusyId.value = id
  errorText.value = ''
  try {
    const current = normalizeGroupChatSettings(props.groupChat)
    const wasMuted = isGroupChatMemberMuted(id, current)
    const next = mergeGroupChatSettings(current, {
      members: {
        ...current.members,
        [id]: {
          ...current.members?.[id],
          muted: !wasMuted,
        },
      },
    })
    const res = await fetch(`/api/chat/conversations/${props.conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupChat: next }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt.slice(0, 200))
    }
    const j = (await res.json()) as { index?: { groupChat?: unknown } }
    const saved = j.index
      ? normalizeGroupChatSettings(j.index.groupChat)
      : next
    emit('groupChatSaved', saved)
  } catch (e) {
    errorText.value =
      e instanceof Error
        ? e.message
        : t('chat.groupChat.roster.muteFailed')
  } finally {
    muteBusyId.value = null
  }
}
</script>

<template>
  <div
    class="composer-group-roster"
    role="toolbar"
    :aria-label="t('chat.groupChat.roster.aria')"
  >
    <p
      v-if="errorText"
      class="composer-group-roster__error"
    >
      {{ errorText }}
    </p>
    <div
      v-for="m in members"
      :key="m.id"
      class="composer-group-roster__row"
      :class="{
        'composer-group-roster__row--expanded': isExpanded(m.id),
        'composer-group-roster__row--muted': m.muted,
      }"
      @mouseenter="onRowEnter(m.id)"
      @mouseleave="onRowLeave(m.id)"
    >
      <button
        type="button"
        class="composer-group-roster__avatar-btn"
        :aria-label="m.name"
        :aria-expanded="isExpanded(m.id)"
        @click="onAvatarClick(m.id, $event)"
      >
        <img
          v-if="m.avatar"
          class="composer-group-roster__avatar"
          :src="m.avatar"
          alt=""
          :style="
            m.color
              ? { boxShadow: `0 0 0 0.125rem ${m.color}` }
              : undefined
          "
        />
        <span
          v-else
          class="composer-group-roster__avatar composer-group-roster__avatar--fallback"
          :style="
            m.color
              ? { boxShadow: `0 0 0 0.125rem ${m.color}` }
              : undefined
          "
        >
          {{ m.name.slice(0, 1) }}
        </span>
        <span
          class="composer-group-roster__mic-badge"
          aria-hidden="true"
          :title="
            m.muted
              ? t('chat.groupChat.roster.muted')
              : t('chat.groupChat.roster.unmuted')
          "
        >
          <v-icon
            :icon="m.muted ? 'mdi-microphone-off' : 'mdi-microphone'"
            size="12"
          />
        </span>
      </button>
      <div
        v-show="isExpanded(m.id)"
        class="composer-group-roster__actions"
      >
        <v-btn
          icon
          size="x-small"
          variant="tonal"
          density="comfortable"
          :loading="muteBusyId === m.id"
          :aria-label="
            m.muted
              ? t('chat.groupChat.roster.unmuteAction')
              : t('chat.groupChat.roster.muteAction')
          "
          @click.stop="onToggleMute(m.id)"
        >
          <v-icon
            :icon="m.muted ? 'mdi-microphone-off' : 'mdi-microphone'"
            size="16"
          />
        </v-btn>
        <v-btn
          icon
          size="x-small"
          variant="tonal"
          density="comfortable"
          :aria-label="t('chat.groupChat.roster.atAction', { name: m.name })"
          @click.stop="onAt(m.name)"
        >
          <v-icon
            icon="mdi-chat"
            size="16"
          />
        </v-btn>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-group-roster {
  position: fixed;
  position-anchor: --chat-header-roster-anchor;
  right: calc(anchor(right) - 3em);
  top: calc(anchor(end) + 3em);
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1rem;
  pointer-events: none;
}

@media (max-width: 600px) {
  .composer-group-roster {
    right: calc(anchor(right) - 30em);
  }
}

.composer-group-roster__row {
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  gap: 0.5rem;
  pointer-events: auto;
}

.composer-group-roster__avatar-btn {
  position: relative;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 50%;
  line-height: 0;
}

.composer-group-roster__avatar {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(var(--v-theme-surface-variant), 1);
  display: block;
}

.composer-group-roster__row--muted .composer-group-roster__avatar {
  filter: grayscale(1);
  opacity: 0.72;
}

.composer-group-roster__avatar--fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.composer-group-roster__row--muted .composer-group-roster__avatar--fallback {
  filter: grayscale(1);
  opacity: 0.72;
}

.composer-group-roster__mic-badge {
  position: absolute;
  right: -0.1rem;
  bottom: -0.1rem;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 0.0625rem rgba(var(--v-theme-on-surface), 0.12);
  pointer-events: none;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.composer-group-roster__actions {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
}

.composer-group-roster__error {
  margin: 0;
  max-width: 12rem;
  font-size: 0.7rem;
  color: rgb(var(--v-theme-error));
  text-align: right;
  pointer-events: none;
}

@supports not (anchor-name: --x) {
  .composer-group-roster {
    position: absolute;
    right: 3em;
    top: calc(100% + 3em);
  }

  @media (max-width: 600px) {
    .composer-group-roster {
      right: 30em;
    }
  }
}
</style>
