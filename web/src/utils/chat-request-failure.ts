/** HTTP / SSE 明确失败（有 error code 或服务端业务错误），勿当成「断连后台保活」 */
export class ChatRequestFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatRequestFailure'
  }
}

export function isChatRequestFailure(e: unknown): e is ChatRequestFailure {
  return (
    e instanceof ChatRequestFailure ||
    (e instanceof Error && e.name === 'ChatRequestFailure')
  )
}
