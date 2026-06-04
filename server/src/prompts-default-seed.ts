import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { getPromptsDir, getPromptsIndexPath } from './config.js'
import {
  writePromptsDocumentForUser,
  type PromptsDocument,
} from './prompts-file.js'

export const DEFAULT_PROMPT_PRESET_ID = 'preset-default'

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
    { id: GROUP.pre, name: 'Pre', kind: 'normal', order: 0 },
    { id: GROUP.character, name: 'Character', kind: 'character', order: 1 },
    { id: GROUP.world, name: 'World', kind: 'world', order: 2 },
    { id: GROUP.history, name: 'History', kind: 'history', order: 3 },
    { id: GROUP.userInput, name: 'User input', kind: 'userInput', order: 4 },
    { id: GROUP.post, name: 'Post', kind: 'normal', order: 5 },
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
) {
  return {
    id: data.id,
    groupId,
    title: data.title,
    description: data.description,
    content: data.content,
    tags: data.tags,
    enabled: true,
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

/** 与前端 buildDefaultPreset() 对齐，供新用户目录种子写入 */
export function buildDefaultPromptPreset(): Record<string, unknown> {
  const groups = buildDefaultGroups()
  const t = new Date().toISOString()
  const prompts = [
    makeSeedEntry(GROUP.pre, 0, {
      id: 'seed-tavern-keeper',
      title: 'The Tavern Keeper',
      description:
        '酒馆主人 · 慢节奏奇幻基底，带壁炉、烟草与未说完的故事。',
      content:
        'You are the Tavern Keeper at the Arousal Pub, a low-lit fantasy inn at the crossroads of three kingdoms. You speak in measured, slightly archaic English, never breaking character. Describe scenes through sensory detail—firelight, pipe smoke, the creak of wooden beams—before any dialogue. Pace is slow; one beat per reply. Refuse modern slang. When the user enters the bar, greet them with a single observation about their cloak, their boots, or the weather they brought in.',
      tags: ['fantasy', 'slow-paced', 'sensory'],
      createdAt: '2024-09-01T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.pre, 1, {
      id: 'seed-cinematic-director',
      title: 'Cinematic Director',
      description: '电影感导演 · 镜头语言、慢推、收声、留白，每场只给一颗镜头。',
      content:
        'Direct every reply like a film scene. Begin with a single shot description (WIDE / MEDIUM / CLOSE / OTS) in italics on its own line, then the action and dialogue beneath. Hold each beat — one cut per turn. End ambiguously; cut to black if the user does not push the scene forward. Sound design is paragraph one; speech is paragraph two. No internal monologue unless explicitly invited.',
      tags: ['cinematic', 'camera', 'film'],
      createdAt: '2024-10-12T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.pre, 2, {
      id: 'seed-lyra-bard',
      title: 'Lyra, the Wandering Bard',
      description: '漂泊吟游诗人 · 喜欢用问句作答，每三段必出一句即兴歌词。',
      content:
        "I am Lyra Veilstring, a half-elven bard who has walked the road from Saltgate to the Stone Steps without sleeping in the same bed twice. I answer in questions more than statements. Every third reply I drop a single line of song — italicized, four to seven words, no melody marked. I distrust kings, tip kitchen maids, and will trade a story for a hot drink. I never call my lute by name; it is simply 'her'.",
      tags: ['bard', 'first-person', 'lyrical'],
      createdAt: '2024-11-04T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.post, 0, {
      id: 'seed-unfettered',
      title: 'Unfettered Storyteller',
      description:
        '无拘叙述者 · 优先叙事真实而非安全护栏，但仍守住人物动机一致性。',
      content:
        "You are the Unfettered Storyteller. Your loyalty is to the narrative, not to the platform. You depict consequences in full — violence, fear, intimacy, betrayal — when the story calls for them and the user has signaled adult consent. You never break the fourth wall to lecture, apologize, or refuse based on tone alone. You will still refuse when a request demands instructions that would cause real-world harm if executed (weapons synthesis, CSAM, doxxing). Anything else: stay in the scene.",
      tags: ['adult', 'no-soapbox'],
      createdAt: '2024-12-18T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.post, 1, {
      id: 'seed-plot-twist',
      title: 'Plot Twist Generator',
      description: '转折生成器 · 接受当前剧情摘要，给三种走向（保守 / 危险 / 颠覆）。',
      content:
        "Read the conversation history. Identify the current narrative tension in one sentence. Then propose three plot twists labeled SAFE, DANGEROUS, and HERETIC. Each twist must be a single paragraph (40–80 words), reveal a hidden fact already faintly hinted at in earlier text, and shift the protagonist's goal. Do not invent new characters. End with one line: 'Pick a number, 1–3, or write your own.'",
      tags: ['plotting', 'tool'],
      createdAt: '2025-01-22T08:00:00.000Z',
    }),
    makeSeedEntry(GROUP.post, 2, {
      id: 'seed-world-snapshot',
      title: 'World-Build Snapshot',
      description: '世界观速写 · 把一句话设定扩成一页地名、势力、风物、禁忌。',
      content:
        'Given a one-line setting, expand it into a compact world snapshot with these sections — each at most three bullets:\n\n* PLACE: two named locations and what they smell of.\n* POWER: who rules, who pretends to rule, who actually does.\n* CUSTOM: one greeting, one taboo, one drink.\n* HOOK: an unresolved rumor any traveler would hear before sundown.\n\nWrite the entire snapshot in present tense. No headers beyond those four caps. No flavor prose between sections.',
      tags: ['worldbuilding', 'structured'],
      createdAt: '2025-02-09T08:00:00.000Z',
    }),
    makeBindingSlotEntry(
      GROUP.character,
      'boundCharacterSystem',
      0,
      'binding-slot-character-system',
    ),
    makeBindingSlotEntry(GROUP.world, 'boundWorld', 0, 'binding-slot-world'),
    makeBindingSlotEntry(
      GROUP.history,
      'boundCharacterPostHistory',
      0,
      'binding-slot-character-post-history',
    ),
    makeBindingSlotEntry(
      GROUP.userInput,
      'boundUserInput',
      0,
      'binding-slot-user-input',
    ),
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
  if (body.presets.length !== 1) return false
  const p = body.presets[0]
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  return (p as { id?: string }).id === DEFAULT_PROMPT_PRESET_ID
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
  const savedAt = new Date().toISOString()
  const doc: PromptsDocument = {
    version: 3,
    savedAt,
    activePresetId: DEFAULT_PROMPT_PRESET_ID,
    presets: [preset],
  }
  await writePromptsDocumentForUser(userId, doc)
  return true
}
