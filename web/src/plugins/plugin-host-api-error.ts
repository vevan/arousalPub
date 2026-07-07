/** 插件宿主 API 结构化错误（含 HTTP 状态与服务端 error 码） */
export class PluginHostApiError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: string
  readonly promptTokens?: number
  readonly budget?: number

  constructor(
    code: string,
    status: number,
    detail?: string,
    opts?: { promptTokens?: number; budget?: number },
  ) {
    super(code)
    this.name = 'PluginHostApiError'
    this.code = code
    this.status = status
    this.detail = detail
    this.promptTokens = opts?.promptTokens
    this.budget = opts?.budget
  }
}

export function isPluginHostApiError(e: unknown): e is PluginHostApiError {
  return e instanceof PluginHostApiError
}
