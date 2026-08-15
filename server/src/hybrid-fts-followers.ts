/**
 * 全局 Hybrid FTS 变更后，仅调度仍跟随全局的 Lore / KB 做 FTS-only 重建。
 * 会话远期记忆不在此自动重建（成本高，由前端对 inherit 会话提示手动重建）。
 */
import { listKnowledgeBases } from './knowledge-base-file.js'
import { scheduleKnowledgeBaseFtsReindex } from './knowledge-vector-index.js'
import { listLorebookIds, readLorebookById } from './lorebook-file.js'
import { scheduleLorebookFtsReindex } from './lorebook-vector-index.js'
import {
  formatHybridFtsSpec,
  type HybridFtsSettings,
} from './hybrid-fts-settings.js'

export interface HybridFtsFollowerScheduleResult {
  lorebookIds: string[]
  knowledgeBaseIds: string[]
}

export async function scheduleHybridFtsFollowerRebuilds(
  previous: HybridFtsSettings,
  next: HybridFtsSettings,
): Promise<HybridFtsFollowerScheduleResult> {
  if (formatHybridFtsSpec(previous) === formatHybridFtsSpec(next)) {
    return { lorebookIds: [], knowledgeBaseIds: [] }
  }

  const lorebookIds: string[] = []
  for (const id of await listLorebookIds()) {
    const lorebook = await readLorebookById(id)
    if (!lorebook || lorebook.hybridFts != null) continue
    lorebookIds.push(id)
  }
  if (lorebookIds.length > 0) {
    scheduleLorebookFtsReindex(lorebookIds)
  }

  const knowledgeBaseIds: string[] = []
  for (const kb of await listKnowledgeBases()) {
    if (kb.hybridFts != null) continue
    knowledgeBaseIds.push(kb.id)
  }
  for (const id of knowledgeBaseIds) {
    scheduleKnowledgeBaseFtsReindex(id)
  }

  return { lorebookIds, knowledgeBaseIds }
}
