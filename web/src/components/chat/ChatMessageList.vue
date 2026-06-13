<script setup lang="ts">
import ChatTurnBlock from '@/components/chat/ChatTurnBlock.vue'
import type { useChatSession } from '@/composables/useChatSession'
import type { ChatScrollerHandle } from '@/composables/chat-session/use-chat-scroll'
import type { ChatTurnItem } from '@/types/chat-turn'
import {
  computed,
  nextTick,
  ref,
  toRefs,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'

const TURN_MIN_ITEM_SIZE_PX = 480

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const {
  chatScrollEl,
  turns,
  errorText,
  hasMoreBefore,
  loadingOlder,
  messagesLoading,
  loadOlderMessages,
  pendingSendTurnOrdinal,
  regeneratingTurnOrdinal,
  editingTurnOrdinal,
  editingSide,
  editDraft,
  streamingText,
  streamingReasoning,
} = toRefs(props.session)

const scrollerRef = ref<ComponentPublicInstance | null>(null)

function asScrollerHandle(comp: ComponentPublicInstance | null): ChatScrollerHandle | null {
  if (!comp) return null
  const exposed = comp as ComponentPublicInstance & {
    scrollToBottom?: () => void
    scrollToItem?: (index: number) => void
  }
  if (typeof exposed.scrollToBottom !== 'function') return null
  return {
    scrollToBottom: () => exposed.scrollToBottom!(),
    scrollToItem: (index: number) => {
      if (typeof exposed.scrollToItem !== 'function') return false
      exposed.scrollToItem(index)
      return true
    },
  }
}

const showScroller = computed(() => turns.value.length > 0)

watch(
  showScroller,
  (show) => {
    if (show) return
    chatScrollEl.value = null
    props.session.registerChatScroller(null)
  },
)

watch(
  scrollerRef,
  async (comp) => {
    await nextTick()
    const el = comp?.$el
    chatScrollEl.value = el instanceof HTMLElement ? el : null
    props.session.registerChatScroller(asScrollerHandle(comp))
  },
  { immediate: true },
)

function turnSizeDeps(turn: ChatTurnItem): unknown[] {
  const deps: unknown[] = [
    turn.user,
    turn.receives.length,
    turn.activeReceiveIndex,
    ...turn.receives.map((r) => r.content),
    ...turn.receives.map((r) => r.reasoning),
  ]
  if (pendingSendTurnOrdinal.value === turn.turnOrdinal) {
    deps.push(streamingText.value, streamingReasoning.value)
  }
  if (regeneratingTurnOrdinal.value === turn.turnOrdinal) {
    deps.push(streamingText.value, streamingReasoning.value)
  }
  if (editingTurnOrdinal.value === turn.turnOrdinal) {
    deps.push(editingSide.value, editDraft.value)
  }
  return deps
}

function onLoadOlderClick() {
  void props.session.loadOlderMessages(true)
}
</script>

<template>
  <div class="chat-body chat-scroll chat-body--virtual">
    <div
      v-if="messagesLoading"
      class="chat-messages-loading"
    >
      <v-progress-circular
        indeterminate
        size="24"
        width="2"
        color="primary"
      />
      <span class="chat-messages-loading__text">{{ $t('chat.messagesLoading') }}</span>
    </div>

    <DynamicScroller
      v-else-if="showScroller"
      ref="scrollerRef"
      class="chat-scroller"
      :items="turns"
      key-field="turnOrdinal"
      :min-item-size="TURN_MIN_ITEM_SIZE_PX"
      :shift="true"
      :buffer="400"
    >
      <template #before>
        <div
          v-if="hasMoreBefore || loadingOlder"
          class="chat-load-older"
          :class="{ 'chat-load-older--busy': loadingOlder }"
        >
          <v-progress-circular
            v-if="loadingOlder"
            indeterminate
            size="20"
            width="2"
            color="primary"
          />
          <button
            v-else
            type="button"
            class="chat-load-older__btn"
            @click="onLoadOlderClick"
          >
            {{ $t('chat.loadOlderTurns') }}
          </button>
        </div>
      </template>

      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :index="index"
          :size-dependencies="turnSizeDeps(item)"
        >
          <ChatTurnBlock
            :turn="item"
            :list-index="index"
            :session="session"
          />
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>

    <div
      v-else-if="!errorText"
      class="chat-empty"
    >
      <div class="chat-empty__ornament">❦</div>
      <div class="chat-empty__text">
        {{ $t('chat.emptyHint') }}
      </div>
    </div>
  </div>
</template>
