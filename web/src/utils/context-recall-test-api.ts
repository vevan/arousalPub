export interface ContextRecallMemoryHit {
  turnId: string
  turnOrdinal: number
  score: number
  preview: string
  content: string
}

export interface ContextRecallLoreHit {
  lorebookId: string
  lorebookName: string
  entryId: string
  title: string
  mode: 'keyword' | 'vector' | 'constant'
  score?: number
  preview: string
  content: string
}

export interface ContextRecallTestResult {
  query: string
  topK: number
  memory: {
    hits: ContextRecallMemoryHit[]
    embeddingError?: string
  }
  lore: {
    lorebookIds: string[]
    hits: ContextRecallLoreHit[]
  }
}

export async function fetchContextRecallTest(
  conversationId: string,
  query: string,
  topK: number,
): Promise<ContextRecallTestResult> {
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/context/recall-test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topK }),
    },
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    const code = body?.error?.trim() || 'validation_failed'
    throw new Error(code)
  }
  return (await res.json()) as ContextRecallTestResult
}
