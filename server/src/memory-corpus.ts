import type { TurnRecord } from './chat-storage.js'
import { getTurnUserText } from './chat-storage.js'
import { createEmbedding } from './embedding-client.js'
import type { MemorySettings } from './memory-settings.js'
import { collectPluginMemoryStripTags } from './memory-plugin-strip-tags.js'
import { assistantTextFromTurn } from './turn-memory-xml.js'

export interface MemoryCorpusOptions {
  stripPluginBlocks: boolean
  stripBlockTags: string[]
  stripExPrefixElements: boolean
}

/** 测试 / 无剥离语料判定 */
export const RAW_MEMORY_CORPUS_OPTIONS: MemoryCorpusOptions = {
  stripPluginBlocks: false,
  stripBlockTags: [],
  stripExPrefixElements: false,
}

function escapeRegExpTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stripMemoryCorpusText(
  text: string,
  opts: MemoryCorpusOptions,
): string {
  let s = text
  if (opts.stripPluginBlocks) {
    for (const tag of opts.stripBlockTags) {
      const esc = escapeRegExpTag(tag)
      s = s.replace(
        new RegExp(`<${esc}>\\s*[\\s\\S]*?\\s*<\\/${esc}>`, 'gi'),
        '',
      )
    }
  }
  if (opts.stripExPrefixElements) {
    s = s.replace(/<ex-[\w-]+>\s*[\s\S]*?\s*<\/ex-[\w-]+>/gi, '')
  }
  return s.trim()
}

export async function resolveMemoryCorpusOptions(
  settings: MemorySettings,
): Promise<MemoryCorpusOptions> {
  const pluginTags = settings.stripPluginBlocks
    ? await collectPluginMemoryStripTags()
    : []
  const userTags = settings.stripBlockTags
  const merged = [...new Set([...pluginTags, ...userTags])]
  return {
    stripPluginBlocks: settings.stripPluginBlocks,
    stripBlockTags: merged,
    stripExPrefixElements: settings.stripExPrefixElements,
  }
}

export function buildMemoryEmbeddingCorpus(
  turn: TurnRecord,
  opts: MemoryCorpusOptions,
): string {
  const u = stripMemoryCorpusText(getTurnUserText(turn), opts)
  const a = stripMemoryCorpusText(assistantTextFromTurn(turn), opts)
  return [u, a].filter((x) => x.length > 0).join('\n\n')
}

export function fuseEmbeddingVectors(
  a: number[],
  b: number[],
  weightA: number,
): number[] {
  const w = Math.max(0, Math.min(1, weightA))
  if (w >= 1) return a.slice()
  if (w <= 0) return b.slice()
  const out = a.map((x, i) => w * x + (1 - w) * (b[i] ?? 0))
  const norm = Math.hypot(...out) || 1
  return out.map((x) => x / norm)
}

export async function buildMemoryRecallVectors(
  conversationId: string,
  params: {
    userText: string
    lastAssistantRaw?: string
    memorySettings: MemorySettings
    corpusOptions: MemoryCorpusOptions
  },
): Promise<{ vector: number[]; ftsQueryText: string } | null> {
  const user = params.userText.trim()
  if (!user) return null
  const ftsQueryText = user

  const assistantRaw = params.lastAssistantRaw?.trim() ?? ''
  const fuseAssistant =
    params.memorySettings.recallFuseLastAssistant && assistantRaw.length > 0
  const userWeight = fuseAssistant
    ? params.memorySettings.recallUserWeight
    : 1

  const embUser = await createEmbedding(user, conversationId)
  if (!embUser) return null

  if (userWeight >= 1) {
    return { vector: embUser.vector, ftsQueryText }
  }

  const assistantStripped = stripMemoryCorpusText(
    assistantRaw,
    params.corpusOptions,
  )
  if (!assistantStripped) {
    return { vector: embUser.vector, ftsQueryText }
  }

  const embAssistant = await createEmbedding(assistantStripped, conversationId)
  if (!embAssistant) {
    return { vector: embUser.vector, ftsQueryText }
  }

  return {
    vector: fuseEmbeddingVectors(
      embUser.vector,
      embAssistant.vector,
      userWeight,
    ),
    ftsQueryText,
  }
}
