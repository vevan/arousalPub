import { fileLibraryContentUrl } from '@/utils/authenticated-media-url'
import { computed, nextTick, ref, watch, type Ref } from 'vue'

export function useConversationMedia(opts: {
  getUserId: () => string | undefined
  getBackgroundImageFileId: () => string | null
  getBgmFileId: () => string | null
  /** 模板 `<audio ref>`；由调用方持有以便 script setup 绑定 */
  bgmAudioRef: Ref<HTMLAudioElement | null>
  /** 清掉绑定上的背景/BGM fileId（切会话时调用） */
  clearMediaFileIds: () => void
}) {
  const backgroundImageUrl = computed(() =>
    fileLibraryContentUrl(opts.getUserId(), opts.getBackgroundImageFileId()),
  )

  const bgmUrl = computed(() =>
    fileLibraryContentUrl(opts.getUserId(), opts.getBgmFileId()),
  )

  const bgmMuted = ref(false)
  const bgmAudioRef = opts.bgmAudioRef
  /** 递增以丢弃过期的 BGM play/load 异步结果 */
  let bgmApplyGen = 0

  const chatPaneStyle = computed(() => {
    const url = backgroundImageUrl.value
    if (!url) return undefined
    // JSON.stringify 保证 CSS url() 引号与转义安全（token URL 本身无引号，防御查询串）
    const cssUrl = JSON.stringify(url)
    return {
      backgroundImage: `linear-gradient(rgba(var(--v-theme-surface), 0.72), rgba(var(--v-theme-surface), 0.82)), url(${cssUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'local',
    } as Record<string, string>
  })

  function stopBgmAudio() {
    bgmApplyGen += 1
    const el = bgmAudioRef.value
    if (!el) return
    el.pause()
    el.removeAttribute('src')
    try {
      el.load()
    } catch {
      /* ignore */
    }
  }

  /** 切会话 / 卸载：立刻清掉上一会话的背景与 BGM，避免串播 */
  function clearConversationMediaBindings() {
    stopBgmAudio()
    opts.clearMediaFileIds()
  }

  async function applyBgmUrl(url: string | null) {
    const gen = ++bgmApplyGen
    await nextTick()
    if (gen !== bgmApplyGen) return
    const el = bgmAudioRef.value
    if (!el) return
    if (!url) {
      el.pause()
      el.removeAttribute('src')
      try {
        el.load()
      } catch {
        /* ignore */
      }
      return
    }
    if (el.src && el.getAttribute('src') === url) {
      el.loop = true
      el.muted = bgmMuted.value
      return
    }
    el.src = url
    el.loop = true
    el.muted = bgmMuted.value
    try {
      await el.play()
    } catch {
      // 浏览器可能拦截无手势自动播放；用户点静音/取消静音后再播
    }
    // 过期 gen 不再动 el，避免 pause 掉更新的音轨
  }

  watch(
    () => bgmUrl.value,
    (url) => {
      void applyBgmUrl(url)
    },
  )

  watch(bgmMuted, (muted) => {
    const el = bgmAudioRef.value
    if (!el) return
    el.muted = muted
    if (!muted && bgmUrl.value) {
      void el.play().catch(() => {})
    }
  })

  function toggleBgmMuted() {
    bgmMuted.value = !bgmMuted.value
  }

  return {
    backgroundImageUrl,
    bgmUrl,
    bgmMuted,
    chatPaneStyle,
    stopBgmAudio,
    clearConversationMediaBindings,
    toggleBgmMuted,
  }
}
