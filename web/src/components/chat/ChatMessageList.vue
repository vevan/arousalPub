<script setup lang="ts">
import ChatTurnBlock from '@/components/chat/ChatTurnBlock.vue'
import type { useChatSession } from '@/composables/useChatSession'
import type { ChatScrollerHandle } from '@/composables/chat-session/use-chat-scroll'
import {
  nextTick,
  onBeforeUnmount,
  ref,
  toRefs,
  watch,
} from 'vue'
import { Virtualizer, type VirtualizerHandle } from 'virtua/vue'

const TURN_ITEM_SIZE_HINT_PX = 480

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
} = toRefs(props.session)

const scrollContainerRef = ref<HTMLElement | null>(null)
const loadOlderHeadRef = ref<HTMLElement | null>(null)
const virtualizerRef = ref<VirtualizerHandle | null>(null)
const startMargin = ref(0)

let startMarginObserver: ResizeObserver | null = null

function syncStartMargin() {
  startMargin.value = loadOlderHeadRef.value?.offsetHeight ?? 0
}

function buildScrollerHandle(): ChatScrollerHandle | null {
  const scrollEl = scrollContainerRef.value
  const virtualizer = virtualizerRef.value
  if (!scrollEl && !virtualizer) return null

  return {
    scrollToBottom: () => {
      if (scrollEl) {
        scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
        return
      }
      if (virtualizer) {
        virtualizer.scrollTo(Math.max(0, virtualizer.scrollSize - virtualizer.viewportSize))
      }
    },
    scrollToItem: (index: number) => {
      if (!virtualizer) return false
      virtualizer.scrollToIndex(index)
      return true
    },
  }
}

async function registerScroller() {
  await nextTick()
  chatScrollEl.value = scrollContainerRef.value
  props.session.registerChatScroller(buildScrollerHandle())
}

watch(
  () => turns.value.length > 0,
  (show) => {
    if (show) return
    chatScrollEl.value = null
    props.session.registerChatScroller(null)
  },
)

watch(
  [virtualizerRef, scrollContainerRef],
  () => {
    void registerScroller()
  },
  { immediate: true },
)

watch(
  loadOlderHeadRef,
  (el, _prev, onCleanup) => {
    startMarginObserver?.disconnect()
    startMarginObserver = null
    if (!el) {
      startMargin.value = 0
      return
    }
    syncStartMargin()
    startMarginObserver = new ResizeObserver(syncStartMargin)
    startMarginObserver.observe(el)
    onCleanup(() => startMarginObserver?.disconnect())
  },
  { flush: 'post' },
)

watch([hasMoreBefore, loadingOlder], () => {
  void nextTick(syncStartMargin)
})

watch(messagesLoading, async (loading) => {
  if (loading) return
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  await registerScroller()
  void props.session.scrollChatToBottom()
})

onBeforeUnmount(() => {
  startMarginObserver?.disconnect()
  chatScrollEl.value = null
  props.session.registerChatScroller(null)
})

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

    <div
      v-else-if="turns.length > 0"
      ref="scrollContainerRef"
      class="chat-scroller chat-scroller--virtua"
    >
      <div
        v-if="hasMoreBefore || loadingOlder"
        ref="loadOlderHeadRef"
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

      <Virtualizer
        ref="virtualizerRef"
        :data="turns"
        :shift="true"
        :buffer-size="1500"
        :item-size="TURN_ITEM_SIZE_HINT_PX"
        :start-margin="startMargin"
        :scroll-ref="scrollContainerRef ?? undefined"
        class="chat-virtua-list"
      >
        <template #default="{ item, index }">
          <ChatTurnBlock
            :key="item.turnOrdinal"
            :turn="item"
            :list-index="index"
            :session="session"
          />
        </template>
      </Virtualizer>
    </div>

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
