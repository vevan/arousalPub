import { existsSync } from 'node:fs'
import { getRegexRulesPath } from './config.js'
import { writeRegexRulesDocument } from './regex-rules-file.js'
import {
  REGEX_RULES_SCHEMA_VERSION,
  type RegexRulesDocument,
} from './regex-rules-types.js'
import { runRequestUser } from './user-context.js'

/** 默认种子规则 id；创建用户时写入 */
export const DEFAULT_REGEX_SEED_RULE_ID = 'a1b2c3d4'

/** `...` / `。。。` 等 → `…`（不含括号） */
export const DEFAULT_ELLIPSIS_PATTERN = '(?:\\.{3,}|。{2,})'

export function buildDefaultRegexRulesDocument(
  savedAt = new Date().toISOString(),
): RegexRulesDocument {
  return {
    schemaVersion: REGEX_RULES_SCHEMA_VERSION,
    savedAt,
    rules: [
      {
        id: DEFAULT_REGEX_SEED_RULE_ID,
        label: '规范省略号',
        order: 10,
        enabled: false,
        phases: ['display'],
        fields: ['user', 'assistant', 'system'],
        skipLastNTurns: 0,
        pattern: DEFAULT_ELLIPSIS_PATTERN,
        flags: 'g',
        replacement: '…',
      },
    ],
  }
}

/** 新建用户时写入默认规则包（仅 registerUser / 首次安装；启动不补种） */
export async function seedDefaultRegexRulesForUser(
  userId: string,
): Promise<boolean> {
  if (existsSync(getRegexRulesPath(userId))) return false
  const doc = buildDefaultRegexRulesDocument()
  await runRequestUser(userId, () => writeRegexRulesDocument(doc, userId))
  return true
}
