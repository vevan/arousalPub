/**
 * 记忆语料剥离原语（无 turn / embedding 依赖，避免模块环）。
 * 语义定案见 DOC/03 §14.4.4。
 */

export interface MemoryCorpusOptions {
  stripPluginBlocks: boolean
  stripBlockTags: string[]
}

/** 测试 / 无剥离语料判定 */
export const RAW_MEMORY_CORPUS_OPTIONS: MemoryCorpusOptions = {
  stripPluginBlocks: false,
  stripBlockTags: [],
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
  return s.trim()
}
