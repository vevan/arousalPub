/** 知识库 id：与世界书预设 id 规则一致 */
export const KNOWLEDGE_BASE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export interface KnowledgeBaseIndexEntry {
  id: string
  name: string
  updatedAt: string
}

export interface KnowledgeBasesIndexDocument {
  schemaVersion: 1
  savedAt: string
  knowledgeBases: KnowledgeBaseIndexEntry[]
}

export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  /** 有序去重；仅 document kind */
  fileIds: string[]
  /** fileId → 展示别名（稀疏）；无别名回退到去扩展名的文件名 */
  fileAliases?: Record<string, string>
  createdAt: string
  updatedAt: string
  /** idle | indexing | ready | error */
  indexStatus?: 'idle' | 'indexing' | 'ready' | 'error'
  indexedAt?: string
  chunkCount?: number
  indexError?: string
}

export interface KnowledgeChunkRecord {
  chunkId: string
  ordinal: number
  text: string
}

export interface KnowledgeFileChunks {
  fileId: string
  /** 索引时文件 updatedAt，用于失效 */
  updatedAt: string
  name: string
  chunks: KnowledgeChunkRecord[]
}

/** 权威切片清单（可重建 Lance） */
export interface KnowledgeChunksDocument {
  schemaVersion: 1
  kbId: string
  embeddingModel?: string
  embeddingDimensions?: number | null
  updatedAt: string
  files: KnowledgeFileChunks[]
}
