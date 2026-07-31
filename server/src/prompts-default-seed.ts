import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { getPromptsDir, getPromptsIndexPath } from './config.js'
import {
  DEFAULT_CHARACTER_SYSTEM_SLOTS,
  DEFAULT_HISTORY_SYSTEM_SLOTS,
  DEFAULT_WORLD_SYSTEM_SLOTS,
} from './system-binding-slots.js'
import {
  writePromptsDocumentForUser,
  type PromptsDocument,
} from './prompts-file.js'

export const DEFAULT_PROMPT_PRESET_ID = 'preset-default'
export const GROUP_CHAT_PRESET_ID = 'preset-group-chat'

export const SEED_PRESET_IDS = [
  DEFAULT_PROMPT_PRESET_ID,
  GROUP_CHAT_PRESET_ID,
] as const

const GROUP = {
  pre: 'group-pre',
  character: 'group-character',
  world: 'group-world',
  history: 'group-history',
  userInput: 'group-user-input',
  post: 'group-post',
} as const

function buildDefaultGroups() {
  return [
    { id: GROUP.pre, name: 'Pre', kind: 'normal', order: 0, enabled: true },
    { id: GROUP.character, name: 'Character', kind: 'character', order: 1, enabled: true },
    { id: GROUP.world, name: 'World', kind: 'world', order: 2, enabled: true },
    { id: GROUP.history, name: 'History', kind: 'history', order: 3, enabled: true },
    { id: GROUP.userInput, name: 'User input', kind: 'userInput', order: 4, enabled: true },
    { id: GROUP.post, name: 'Post', kind: 'normal', order: 5, enabled: true },
  ]
}

function makeSeedEntry(
  groupId: string,
  order: number,
  data: {
    id: string
    title: string
    description: string
    content: string
    tags: string[]
    createdAt: string
  },
  opts?: { enabled?: boolean },
) {
  return {
    id: data.id,
    groupId,
    title: data.title,
    description: data.description,
    content: data.content,
    tags: data.tags,
    enabled: opts?.enabled !== false,
    role: 'system',
    injectionPosition: 'relative',
    injectionDepth: 0,
    injectionOrder: 100,
    triggers: [],
    order,
    isSeed: true,
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
  }
}

function makeBindingSlotEntry(
  groupId: string,
  slot: string,
  order: number,
  id: string,
) {
  const t = new Date().toISOString()
  return {
    id,
    groupId,
    title: '',
    content: '',
    description: '',
    tags: [],
    enabled: true,
    role: 'system',
    injectionPosition: 'relative',
    injectionDepth: 0,
    injectionOrder: 100,
    triggers: [],
    order,
    bindingSlot: slot,
    createdAt: t,
    updatedAt: t,
  }
}

type PresetBindingGroupIds = {
  character: string
  world: string
  history: string
  userInput: string
}

function buildBindingSlotPrompts(groupIds: PresetBindingGroupIds) {
  const characterSlots = DEFAULT_CHARACTER_SYSTEM_SLOTS.map((slot, i) =>
    makeBindingSlotEntry(
      groupIds.character,
      slot,
      i,
      `binding-slot-${slot.replace(/^bound/, '')}`,
    ),
  )
  return [
    ...characterSlots,
    // After 默认挂在 Character 末尾（与 normalize 缺槽补全一致）
    makeBindingSlotEntry(
      groupIds.character,
      'boundWorldAfter',
      characterSlots.length,
      'binding-slot-WorldAfter',
    ),
    ...DEFAULT_WORLD_SYSTEM_SLOTS.map((slot, i) =>
      makeBindingSlotEntry(
        groupIds.world,
        slot,
        i,
        `binding-slot-${slot.replace(/^bound/, '')}`,
      ),
    ),
    ...DEFAULT_HISTORY_SYSTEM_SLOTS.map((slot, i) =>
      makeBindingSlotEntry(
        groupIds.history,
        slot,
        i,
        `binding-slot-${slot.replace(/^bound/, '')}`,
      ),
    ),
    makeBindingSlotEntry(
      groupIds.userInput,
      'boundUserInput',
      0,
      'binding-slot-user-input',
    ),
  ]
}

/** 群聊专用预设：默认未激活；条目默认 disabled，开启群聊后切换并启用（G5） */
export function buildGroupChatPromptPreset(): Record<string, unknown> {
  const groupIds = {
    pre: 'group-chat-pre',
    character: 'group-chat-character',
    world: 'group-chat-world',
    history: 'group-chat-history',
    userInput: 'group-chat-user-input',
    post: 'group-chat-post',
  } as const
  const groups = [
    { id: groupIds.pre, name: 'Pre', kind: 'normal', order: 0, enabled: true },
    {
      id: groupIds.character,
      name: 'Character',
      kind: 'character',
      order: 1,
      enabled: true,
    },
    { id: groupIds.world, name: 'World', kind: 'world', order: 2, enabled: true },
    {
      id: groupIds.history,
      name: 'History',
      kind: 'history',
      order: 3,
      enabled: true,
    },
    {
      id: groupIds.userInput,
      name: 'User input',
      kind: 'userInput',
      order: 4,
      enabled: true,
    },
    { id: groupIds.post, name: 'Post', kind: 'normal', order: 5, enabled: true },
  ]
  const t = new Date().toISOString()
  const prompts = [
    makeSeedEntry(
      groupIds.pre,
      0,
      {
        id: 'seed-group-roster',
        title: 'Group roster',
        description:
          'Group roster · lists characters present; muted members via {{groupNotMuted}}.',
        content:
          'This conversation is a group scene. Participants (binding order): {{group}}.\nActive speakers (not muted): {{groupNotMuted}}.\nOnly write dialogue and actions for the character you are currently playing.',
        tags: ['group-chat', 'roster'],
        createdAt: '2026-07-03T08:00:00.000Z',
      },
      { enabled: false },
    ),
    makeSeedEntry(
      groupIds.pre,
      1,
      {
        id: 'seed-group-speaker',
        title: 'Current speaker focus',
        description:
          'Current speaker · {{char}} is this turn\'s POV; {{notChar}} are the other bound characters.',
        content:
          'You are {{char}} for this reply. The other bound characters in this scene are: {{notChar}}.\nStay in {{char}}\'s voice. Do not speak lines or internal monologue for {{notChar}} unless the user explicitly asks you to.',
        tags: ['group-chat', 'speaker'],
        createdAt: '2026-07-03T08:00:00.000Z',
      },
      { enabled: false },
    ),
    makeSeedEntry(
      groupIds.post,
      0,
      {
        id: 'seed-group-single-fallback',
        title: 'Single-character fallback line',
        description:
          'Keeps a {{charIfNotGroup}} line when not in group chat; empty when group mode is enabled.',
        content:
          'Primary character label (empty in group mode): {{charIfNotGroup}}',
        tags: ['group-chat', 'macro'],
        createdAt: '2026-07-03T08:00:00.000Z',
      },
      { enabled: false },
    ),
    ...buildBindingSlotPrompts(groupIds),
  ]
  return {
    id: GROUP_CHAT_PRESET_ID,
    name: 'Group chat',
    groups,
    prompts,
    createdAt: t,
    updatedAt: t,
  }
}

/** 与前端 buildDefaultPreset() 对齐，供新用户目录种子写入 */
export function buildDefaultPromptPreset(): Record<string, unknown> {
  const groups = buildDefaultGroups()
  const t = new Date().toISOString()
  const prompts = [
    makeSeedEntry(GROUP.pre, 0, {
      id: 'seed-tavern-keeper',
      title: 'The Tavern Keeper',
      description:
        'Tavern keeper · slow-paced fantasy base with hearth, pipe smoke, and unfinished stories.',
      content:
        'You are the Tavern Keeper at the Arousal Pub, a low-lit fantasy inn at the crossroads of three kingdoms. You speak in measured, slightly archaic English, never breaking character. Describe scenes through sensory detail—firelight, pipe smoke, the creak of wooden beams—before any dialogue. Pace is slow; one beat per reply. Refuse modern slang. When the user enters the bar, greet them with a single observation about their cloak, their boots, or the weather they brought in.',
      tags: ['fantasy', 'slow-paced', 'sensory'],
      createdAt: '2024-09-01T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.pre, 1, {
      id: 'seed-cinematic-director',
      title: 'Cinematic Director',
      description:
        'Cinematic director · shot language, slow pushes, quiet cuts, one camera beat per turn.',
      content:
        'Direct every reply like a film scene. Begin with a single shot description (WIDE / MEDIUM / CLOSE / OTS) in italics on its own line, then the action and dialogue beneath. Hold each beat — one cut per turn. End ambiguously; cut to black if the user does not push the scene forward. Sound design is paragraph one; speech is paragraph two. No internal monologue unless explicitly invited.',
      tags: ['cinematic', 'camera', 'film'],
      createdAt: '2024-10-12T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.pre, 2, {
      id: 'seed-lyra-bard',
      title: 'Lyra, the Wandering Bard',
      description:
        'Wandering bard · answers in questions; every third reply drops a short improvised lyric.',
      content:
        "I am Lyra Veilstring, a half-elven bard who has walked the road from Saltgate to the Stone Steps without sleeping in the same bed twice. I answer in questions more than statements. Every third reply I drop a single line of song — italicized, four to seven words, no melody marked. I distrust kings, tip kitchen maids, and will trade a story for a hot drink. I never call my lute by name; it is simply 'her'.",
      tags: ['bard', 'first-person', 'lyrical'],
      createdAt: '2024-11-04T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.post, 0, {
      id: 'seed-unfettered',
      title: 'Unfettered Storyteller',
      description:
        'Unfettered narrator · favors story truth over soft guardrails, while keeping character motives consistent.',
      content:
        "You are the Unfettered Storyteller. Your loyalty is to the narrative, not to the platform. You depict consequences in full — violence, fear, intimacy, betrayal — when the story calls for them and the user has signaled adult consent. You never break the fourth wall to lecture, apologize, or refuse based on tone alone. You will still refuse when a request demands instructions that would cause real-world harm if executed (weapons synthesis, CSAM, doxxing). Anything else: stay in the scene.",
      tags: ['adult', 'no-soapbox'],
      createdAt: '2024-12-18T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.post, 1, {
      id: 'seed-plot-twist',
      title: 'Plot Twist Generator',
      description:
        'Plot-twist generator · takes the current beat and offers three paths (safe / dangerous / heretic).',
      content:
        "Read the conversation history. Identify the current narrative tension in one sentence. Then propose three plot twists labeled SAFE, DANGEROUS, and HERETIC. Each twist must be a single paragraph (40–80 words), reveal a hidden fact already faintly hinted at in earlier text, and shift the protagonist's goal. Do not invent new characters. End with one line: 'Pick a number, 1–3, or write your own.'",
      tags: ['plotting', 'tool'],
      createdAt: '2025-01-22T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.post, 2, {
      id: 'seed-world-snapshot',
      title: 'World-Build Snapshot',
      description:
        'World-build snapshot · expands a one-line premise into places, powers, customs, and a rumor hook.',
      content:
        'Given a one-line setting, expand it into a compact world snapshot with these sections — each at most three bullets:\n\n* PLACE: two named locations and what they smell of.\n* POWER: who rules, who pretends to rule, who actually does.\n* CUSTOM: one greeting, one taboo, one drink.\n* HOOK: an unresolved rumor any traveler would hear before sundown.\n\nWrite the entire snapshot in present tense. No headers beyond those four caps. No flavor prose between sections.',
      tags: ['worldbuilding', 'structured'],
      createdAt: '2025-02-09T08:00:00.000Z',
    }),
    ...buildBindingSlotPrompts(GROUP),
  ]
  return {
    id: DEFAULT_PROMPT_PRESET_ID,
    name: 'Default',
    groups,
    prompts,
    createdAt: t,
    updatedAt: t,
  }
}

export function isPromptsSeedPut(body: {
  activePresetId: string
  presets: unknown[]
}): boolean {
  if (body.activePresetId !== DEFAULT_PROMPT_PRESET_ID) return false
  if (body.presets.length !== SEED_PRESET_IDS.length) return false
  const ids = body.presets.map((p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null
    return (p as { id?: string }).id ?? null
  })
  if (ids.some((id) => !id)) return false
  const sorted = [...ids].sort()
  const expected = [...SEED_PRESET_IDS].sort()
  return sorted.every((id, i) => id === expected[i])
}

/**
 * 新用户目录初始化：写入 preset-default 种子（全量 PUT，仅服务端在创建用户时调用）。
 * 若已有 index.json 则跳过。
 */
async function hasAnyPromptPresetFiles(userId: string): Promise<boolean> {
  const dir = getPromptsDir(userId)
  if (!existsSync(dir)) return false
  const names = await readdir(dir).catch(() => [] as string[])
  return names.some((n) => n.endsWith('.json') && n !== 'index.json')
}

export async function seedDefaultPromptsForUser(userId: string): Promise<boolean> {
  if (existsSync(getPromptsIndexPath(userId))) return false
  if (await hasAnyPromptPresetFiles(userId)) return false
  const preset = buildDefaultPromptPreset()
  const groupPreset = buildGroupChatPromptPreset()
  const savedAt = new Date().toISOString()
  const doc: PromptsDocument = {
    version: 3,
    savedAt,
    activePresetId: DEFAULT_PROMPT_PRESET_ID,
    presets: [preset, groupPreset],
  }
  await writePromptsDocumentForUser(userId, doc)
  return true
}
