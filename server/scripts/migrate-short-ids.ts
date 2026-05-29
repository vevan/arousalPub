/**
 * 将存量 turnId、receive.id、prompt preset/group/entry 的长 UUID id 迁为 8 位 hex。
 * 运行：npm run migrate:short-ids -w server
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from '../src/config.js'
import {
  mapToShortId,
  shouldMigrateToShortId,
} from '../src/short-id.js'

const PRESET_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

function remapId(oldId: string, used: Set<string>, idMap: Map<string, string>): string {
  const t = oldId.trim()
  if (!t) return t
  const cached = idMap.get(t)
  if (cached) return cached
  if (!shouldMigrateToShortId(t)) {
    if (!used.has(t)) used.add(t)
    idMap.set(t, t)
    return t
  }
  const next = mapToShortId(t, used)
  idMap.set(t, next)
  return next
}

async function migratePromptsForUser(
  userDir: string,
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>()
  const promptsDir = path.join(userDir, 'prompts')
  const indexPath = path.join(promptsDir, 'index.json')
  if (!existsSync(indexPath)) return idMap

  const used = new Set<string>()
  const indexRaw = await readFile(indexPath, 'utf8')
  const index = JSON.parse(indexRaw) as {
    activePresetId?: string
    presets?: { id: string }[]
  }

  const presetBodies: { oldFileId: string; body: Record<string, unknown> }[] = []
  for (const entry of index.presets ?? []) {
    const filePath = path.join(promptsDir, `${entry.id}.json`)
    if (!existsSync(filePath)) continue
    const raw = await readFile(filePath, 'utf8')
    presetBodies.push({
      oldFileId: entry.id,
      body: JSON.parse(raw) as Record<string, unknown>,
    })
  }

  for (const { body } of presetBodies) {
    if (typeof body.id === 'string') remapId(body.id, used, idMap)
    for (const g of Array.isArray(body.groups) ? body.groups : []) {
      const go = g as { id?: string }
      if (typeof go.id === 'string') remapId(go.id, used, idMap)
    }
    for (const p of Array.isArray(body.prompts) ? body.prompts : []) {
      const po = p as { id?: string }
      if (typeof po.id === 'string') remapId(po.id, used, idMap)
    }
  }

  const hasChanges = [...idMap.entries()].some(([a, b]) => a !== b)
  if (!hasChanges) return idMap

  const keepFiles = new Set<string>(['index.json'])
  const migratedPresets: Record<string, unknown>[] = []
  const savedAt = new Date().toISOString()

  for (const { oldFileId, body } of presetBodies) {
    const newPresetId = remapId(
      typeof body.id === 'string' ? body.id : oldFileId,
      used,
      idMap,
    )
    const groups = (Array.isArray(body.groups) ? body.groups : []).map((g) => {
      const go = { ...(g as object) } as { id?: string }
      if (typeof go.id === 'string') go.id = remapId(go.id, used, idMap)
      return go
    })
    const prompts = (Array.isArray(body.prompts) ? body.prompts : []).map((p) => {
      const po = { ...(p as object) } as { id?: string; groupId?: string }
      if (typeof po.id === 'string') po.id = remapId(po.id, used, idMap)
      if (typeof po.groupId === 'string') {
        po.groupId = remapId(po.groupId, used, idMap)
      }
      return po
    })
    const nextBody = { ...body, id: newPresetId, groups, prompts, updatedAt: savedAt }
    migratedPresets.push(nextBody)
    const fileName = `${newPresetId}.json`
    keepFiles.add(fileName)
    await writeFile(
      path.join(promptsDir, fileName),
      `${JSON.stringify(nextBody, null, 2)}\n`,
      'utf8',
    )
    if (`${oldFileId}.json` !== fileName) {
      await rm(path.join(promptsDir, `${oldFileId}.json`), { force: true })
    }
  }

  const activePresetId = index.activePresetId
    ? remapId(index.activePresetId, used, idMap)
    : (migratedPresets[0] as { id?: string } | undefined)?.id ?? ''

  await writeFile(
    indexPath,
    `${JSON.stringify(
      {
        version: 3,
        savedAt,
        activePresetId,
        presets: migratedPresets.map((p) => {
          const po = p as { id?: string; name?: string }
          return {
            id: po.id ?? '',
            name: typeof po.name === 'string' ? po.name : '',
            updatedAt: savedAt,
          }
        }),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const names = await readdir(promptsDir)
  for (const name of names) {
    if (!name.endsWith('.json') || keepFiles.has(name)) continue
    const id = name.slice(0, -5)
    if (!PRESET_ID_RE.test(id)) continue
    await rm(path.join(promptsDir, name), { force: true })
  }

  // eslint-disable-next-line no-console
  console.log(`  prompts: migrated ${[...idMap.entries()].filter(([a, b]) => a !== b).length} id(s)`)
  return idMap
}

async function migrateConversationDir(
  convDir: string,
  promptIdMap: Map<string, string>,
): Promise<number> {
  let changes = 0
  const used = new Set<string>()
  const turnIdMap = new Map<string, string>()

  const indexPath = path.join(convDir, 'index.json')
  if (existsSync(indexPath)) {
    const raw = await readFile(indexPath, 'utf8')
    const idx = JSON.parse(raw) as Record<string, unknown>
    if (typeof idx.promptPresetId === 'string') {
      const next = promptIdMap.get(idx.promptPresetId) ?? idx.promptPresetId
      if (next !== idx.promptPresetId) {
        idx.promptPresetId = next
        await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, 'utf8')
        changes++
      }
    }
  }

  const names = await readdir(convDir)
  for (const name of names) {
    if (!name.startsWith('turn-') || !name.endsWith('.json')) continue
    const filePath = path.join(convDir, name)
    const chunk = JSON.parse(await readFile(filePath, 'utf8')) as {
      turns?: { turnId?: string; receives?: { id?: string }[] }[]
    }
    let chunkTouched = false
    for (const turn of chunk.turns ?? []) {
      if (typeof turn.turnId === 'string') {
        const old = turn.turnId.trim()
        if (old && shouldMigrateToShortId(old)) {
          const next = turnIdMap.get(old) ?? mapToShortId(old, used)
          turnIdMap.set(old, next)
          turn.turnId = next
          chunkTouched = true
        } else if (old) {
          used.add(old)
        }
      }
      for (const rec of turn.receives ?? []) {
        if (typeof rec.id !== 'string') continue
        const old = rec.id.trim()
        if (!old) continue
        if (shouldMigrateToShortId(old)) {
          rec.id = mapToShortId(old, used)
          chunkTouched = true
        } else {
          used.add(old)
        }
      }
    }
    if (chunkTouched) {
      await writeFile(filePath, `${JSON.stringify(chunk, null, 2)}\n`, 'utf8')
      changes++
    }
  }

  const chatPromptPath = path.join(convDir, 'chat-prompt.json')
  if (existsSync(chatPromptPath) && turnIdMap.size > 0) {
    const doc = JSON.parse(await readFile(chatPromptPath, 'utf8')) as {
      entries?: { turnId?: string }[]
    }
    let touched = false
    for (const e of doc.entries ?? []) {
      if (typeof e.turnId !== 'string') continue
      const next = turnIdMap.get(e.turnId)
      if (next && next !== e.turnId) {
        e.turnId = next
        touched = true
      }
    }
    if (touched) {
      await writeFile(chatPromptPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
      changes++
    }
  }

  const convId = path.basename(convDir)
  const memoryDir = path.join(convDir, '..', '..', 'memory', 'conversations', convId)
  if (existsSync(memoryDir) && (changes > 0 || turnIdMap.size > 0)) {
    await rm(memoryDir, { recursive: true, force: true })
    // eslint-disable-next-line no-console
    console.log(`  [memory] cleared ${convId} (请在对话设置中重建记忆索引)`)
  }

  return changes
}

async function migrateUser(userDir: string): Promise<void> {
  const userId = path.basename(userDir)
  // eslint-disable-next-line no-console
  console.log(`\n[user] ${userId}`)

  const promptIdMap = await migratePromptsForUser(userDir)
  const chatsRoot = path.join(userDir, 'chats')
  if (!existsSync(chatsRoot)) return

  for (const convId of await readdir(chatsRoot)) {
    const convDir = path.join(chatsRoot, convId)
    const st = await stat(convDir).catch(() => null)
    if (!st?.isDirectory()) continue
    const n = await migrateConversationDir(convDir, promptIdMap)
    if (n > 0) {
      // eslint-disable-next-line no-console
      console.log(`  chat ${convId}: ${n} file(s) updated`)
    }
  }
}

async function main(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    // eslint-disable-next-line no-console
    console.log(`data dir not found: ${DATA_DIR}`)
    return
  }
  for (const userId of await readdir(DATA_DIR)) {
    const userDir = path.join(DATA_DIR, userId)
    const st = await stat(userDir).catch(() => null)
    if (!st?.isDirectory()) continue
    await migrateUser(userDir)
  }
  // eslint-disable-next-line no-console
  console.log('\ndone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
