/** 插件宿主 API 结构化错误（含 HTTP 状态与服务端 error 码） */
export class PluginHostApiError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: string
  readonly promptTokens?: number
  readonly budget?: number
  readonly debug?: unknown

  constructor(
    code: string,
    status: number,
    detail?: string,
    opts?: { promptTokens?: number; budget?: number; debug?: unknown },
  ) {
    super(code)
    this.name = 'PluginHostApiError'
    this.code = code
    this.status = status
    this.detail = detail
    this.promptTokens = opts?.promptTokens
    this.budget = opts?.budget
    this.debug = opts?.debug
  }
}

export function isPluginHostApiError(e: unknown): e is PluginHostApiError {
  return e instanceof PluginHostApiError
}
