import { runInNewContext } from 'node:vm'

export const REGEX_EXEC_TIMEOUT_MS = 250

export type RegexExecResult =
  | { ok: true; text: string }
  | { ok: false; code: 'regex_exec_timeout' | 'regex_exec_error' }

/** 在隔离 VM 中执行 replace，超时则中止（DOC/24） */
export function replaceRegexWithTimeout(
  pattern: string,
  flags: string,
  text: string,
  replacement: string,
  timeoutMs = REGEX_EXEC_TIMEOUT_MS,
): RegexExecResult {
  let validated: RegExp
  try {
    validated = new RegExp(pattern, flags)
  } catch {
    return { ok: false, code: 'regex_exec_error' }
  }
  const source = validated.source
  const validatedFlags = validated.flags
  try {
    const out = runInNewContext(
      `(function (source, flags, text, replacement) {
        const re = new RegExp(source, flags);
        return text.replace(re, replacement);
      })(source, flags, text, replacement)`,
      { source, flags: validatedFlags, text, replacement },
      { timeout: timeoutMs },
    )
    if (typeof out !== 'string') {
      return { ok: false, code: 'regex_exec_error' }
    }
    return { ok: true, text: out }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/timed out/i.test(msg)) {
      return { ok: false, code: 'regex_exec_timeout' }
    }
    return { ok: false, code: 'regex_exec_error' }
  }
}
