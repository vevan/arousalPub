import { i18n } from '@/i18n'

/** 将服务端 `{ error: code }` 或账号 API 错误码转为本地化文案 */
export function translateApiError(codeOrMsg: string): string {
  const raw = codeOrMsg.trim()
  if (!raw) return ''
  const { t, te } = i18n.global
  const keys = [
    `api.errors.${raw}`,
    `settings.accountApiErrors.${raw}`,
  ]
  for (const key of keys) {
    if (te(key)) return t(key)
  }
  return raw
}

/** 从 fetch 响应 JSON 解析 error 字段并翻译 */
export function apiErrorFromResponseBody(
  data: unknown,
  fallbackCode: string,
): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: unknown }).error
    if (typeof err === 'string' && err.trim()) {
      return translateApiError(err.trim())
    }
  }
  return translateApiError(fallbackCode)
}
