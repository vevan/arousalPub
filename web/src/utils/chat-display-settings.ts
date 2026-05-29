/** 输入框：Enter 发送，Ctrl/Cmd+Enter 换行 */
export type ComposerEnterMode = 'enter-send' | 'ctrl-enter-send'

export const COMPOSER_ENTER_MODE_DEFAULT: ComposerEnterMode = 'enter-send'

export function normalizeComposerEnterMode(value: unknown): ComposerEnterMode {
  return value === 'ctrl-enter-send' ? 'ctrl-enter-send' : 'enter-send'
}

/** 对话正文字号（rem，相对浏览器根字号，默认 1rem ≈ 16px） */
export const CHAT_FONT_SIZE_REM_DEFAULT = 1
export const CHAT_FONT_SIZE_REM_MIN = 0.75
export const CHAT_FONT_SIZE_REM_MAX = 1.5

export function normalizeChatFontSizeRem(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : Number.parseFloat(typeof value === 'string' ? value : '')
  if (!Number.isFinite(n)) return CHAT_FONT_SIZE_REM_DEFAULT
  const clamped = Math.min(
    CHAT_FONT_SIZE_REM_MAX,
    Math.max(CHAT_FONT_SIZE_REM_MIN, n),
  )
  return Math.round(clamped * 1000) / 1000
}
