export const REGEX_EXEC_TIMEOUT_MS = 250

export const REGEX_MAX_INPUT_LENGTH = 512_000

export type RegexExecResult =
  | { ok: true; text: string }
  | { ok: false; code: 'regex_exec_timeout' | 'regex_exec_error' }

/** 浏览器同步 replace；超时仅在 replace 返回后检测（无法中断灾难性回溯） */
export function replaceRegexWithTimeoutSync(
  pattern: string,
  flags: string,
  text: string,
  replacement: string,
  timeoutMs = REGEX_EXEC_TIMEOUT_MS,
): RegexExecResult {
  if (text.length > REGEX_MAX_INPUT_LENGTH) {
    return { ok: false, code: 'regex_exec_error' }
  }
  try {
    const t0 = performance.now()
    const re = new RegExp(pattern, flags)
    const out = text.replace(re, replacement)
    if (performance.now() - t0 > timeoutMs) {
      return { ok: false, code: 'regex_exec_timeout' }
    }
    return { ok: true, text: out }
  } catch {
    return { ok: false, code: 'regex_exec_error' }
  }
}
