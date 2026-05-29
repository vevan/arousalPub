export async function readJsonSseStream<T>(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!body) throw new Error('No response body')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data) continue
      onEvent(JSON.parse(data) as T)
    }
  }
}
