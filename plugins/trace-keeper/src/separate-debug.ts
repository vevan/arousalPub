export type TraceKeeperSeparateDebug = {
  messages: { role: string; content: string }[]
  code?: string
  upstreamPayload?: unknown
  upstreamStatus?: number
  upstreamRawBody?: string
  assistantContent?: string
}
