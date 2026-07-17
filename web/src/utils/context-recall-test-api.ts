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
  scoreKind?: 'rrf' | 'vector_fallback'
  preview: string
  content: string
}

export interface ContextRecallKnowledgeHit {
  kbId: string
  kbName: string
  fileId: string
  fileName: string
  chunkId: string
  ordinal: number
  score: number
  preview: string
  content: string
}

export interface ContextRecallTestResult {
  query: string
  topK: number
  simulateTurnOrdinal?: number
  loreScanCorpusChars: number
  memory: {
    hits: ContextRecallMemoryHit[]
    embeddingError?: string
  }
  lore: {
    lorebookIds: string[]
    hits: ContextRecallLoreHit[]
  }
  knowledge: {
    knowledgeBaseIds: string[]
    hits: ContextRecallKnowledgeHit[]
  }
}

export async function fetchContextRecallTest(
  conversationId: string,
  query: string,
  topK: number,
  simulateTurnOrdinal?: number,
): Promise<ContextRecallTestResult> {
  const body: Record<string, unknown> = { query, topK }
  if (
    typeof simulateTurnOrdinal === 'number' &&
    Number.isInteger(simulateTurnOrdinal)
  ) {
    body.simulateTurnOrdinal = simulateTurnOrdinal
  }
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/context/recall-test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null
    const code = payload?.error?.trim() || 'validation_failed'
    throw new Error(code)
  }
  return (await res.json()) as ContextRecallTestResult
}
