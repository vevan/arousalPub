import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createI18n } from 'vue-i18n'
import { beginDungeonCombat, advanceDungeonCombat } from '../src/battle.ts'
import { DEFAULT_DUNGEON_CATALOG } from '../src/catalog.ts'
import { createDungeonMaze, createDungeonMapEvent } from '../src/maze.ts'
import { formatCombatReport } from '../src/narration.ts'
import { register } from '../src/index.ts'

function finishedBattle() {
  const maze = createDungeonMaze(12345)
  const enemy = maze.entities.find((entity) => entity.kind === 'minion')!
  const rolls = [0.99, 0, 0.99, 0.99]
  const random = () => rolls.shift() ?? 0
  const started = beginDungeonCombat({ ...maze, activeEvent: createDungeonMapEvent(enemy) }, DEFAULT_DUNGEON_CATALOG, random)!
  return advanceDungeonCombat(started, random)!
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 15))

const zh = JSON.parse(readFileSync(new URL('../locales/zh.json', import.meta.url), 'utf8'))
const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8'))
function translator(locale: 'zh' | 'en') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, messages: { zh, en } })
  return (key: string, params: Record<string, unknown> = {}) => i18n.global.t(key, params)
}

test('formatted report preserves resolved facts and rejects unfinished battles', () => {
  const combat = finishedBattle().activeCombat!
  const t = translator('zh')
  const report = formatCombatReport(combat, t)
  assert.match(report, /冒险者胜利/)
  assert.match(report, /攻击 d20=20/)
  assert.match(report, /伤害=10；目标剩余 HP=0/)
  assert.match(report, /冒险者/)
  assert.throws(() => formatCombatReport({ ...combat, outcome: null }, t), /combat_not_finished/)
})

test('both locales compile report templates', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  const combat = finishedBattle().activeCombat!
  // Names and effects are data: interpolation must preserve i18n-special characters.
  combat.combatants[0].name = 'Hero {@$|}'
  combat.log[0].effectsApplied = ['effect {@$|}']
  for (const locale of ['zh', 'en'] as const) {
    const t = translator(locale)
    const report = formatCombatReport(combat, t)
    assert.match(report, /Hero \{@\$\|\}/)
    assert.match(report, /effect \{@\$\|\}/)
    assert.doesNotMatch(report, /\{(?:actor|target|damage|hp|effects)\}/)
    const miss = { ...combat.log[0], hit: false, damageTotal: 0, rolls: { attackD20: 1, attackTotal: 1 } }
    const defeat = formatCombatReport({ ...combat, outcome: 'defeat', log: [miss] }, t)
    assert.match(defeat, locale === 'zh' ? /冒险者败北/ : /Adventurer defeat/)
    assert.match(defeat, locale === 'zh' ? /未掷/ : /Not rolled/)
    assert.match(defeat, locale === 'zh' ? /未命中/ : /Miss/)
  }
})

test('fills composer without sending, preserves drafts, and ignores unfinished combat', async () => {
  let settings = { dungeonStates: { '': finishedBattle() } }
  let action: (event: { action: string }) => void = () => {}
  let held = true
  let userInput = 'My existing draft'
  let pluginSettings: Record<string, unknown> = {}
  const host = {
    plugins: { getUserSettings: async () => pluginSettings },
    composer: {
      get userInput() { return userInput },
      setUserInput(text: string) { userInput = text },
    },
    pluginKey: (key: string) => key, t: translator('en'),
    registerSlotButton() {}, registerStyles() {}, refreshSlotButtons() {},
    conversation: {
      getId: () => 'draft-test', getActiveBranchPath: async () => '',
      getPluginSettings: async () => settings,
      patchPluginSettings: async (partial: typeof settings) => { settings = { ...settings, ...partial }; return settings },
      onPluginSettingsChanged: () => () => {},
      acquirePluginHold: () => { held = true; return 'hold' },
      releasePluginHold: () => { held = false }, hasPluginHold: () => held,
    },
    lifecycle: { onTurnDataChanged: () => () => {}, onBranchCreated: () => () => {} },
    ui: { notify() {}, panel: {
      register() {}, open() {}, setHtml() {},
      onEvent: (_placement: string, _pluginId: string, handlers: { onAction: typeof action }) => { action = handlers.onAction },
    } },
  }
  settings.dungeonStates[''].activeCombat!.outcome = null
  register(host as unknown as Parameters<typeof register>[0])
  await tick()
  action({ action: 'combat:draft' })
  await tick()
  assert.equal(host.composer.userInput, 'My existing draft')
  assert.equal(held, true)
  settings = { dungeonStates: { '': finishedBattle() } }
  action({ action: 'combat:draft' })
  await tick()
  const draft = host.composer.userInput
  assert.ok(draft.startsWith('My existing draft\n\n# Resolved combat log'))
  assert.match(draft, /damage=10/)
  assert.ok(draft.endsWith(en.combatAdditionalPromptDefault))
  assert.equal(held, false)
  action({ action: 'combat:draft' })
  await tick()
  assert.equal(host.composer.userInput, draft)
  assert.ok(settings.dungeonStates[''].activeCombat)
  userInput = ''
  action({ action: 'combat:draft' })
  await tick()
  assert.ok(host.composer.userInput.startsWith('# Resolved combat log'))
  pluginSettings = { combatAdditionalPrompt: 'Custom instructions: {{user}} @ $ |\nKeep the outcome.' }
  userInput = ''
  action({ action: 'combat:draft' })
  await tick()
  assert.ok(userInput.endsWith(pluginSettings.combatAdditionalPrompt as string))
  assert.ok(!userInput.includes(en.combatAdditionalPromptDefault))
  pluginSettings.combatPromptPosition = 'above'
  userInput = 'Existing draft'
  action({ action: 'combat:draft' })
  await tick()
  assert.ok(userInput.startsWith(`Existing draft\n\n${pluginSettings.combatAdditionalPrompt}\n\n# Resolved combat log`))
  const aboveDraft = userInput
  action({ action: 'combat:draft' })
  await tick()
  assert.equal(userInput, aboveDraft)
  pluginSettings = { combatAdditionalPrompt: '  ' }
  userInput = ''
  action({ action: 'combat:draft' })
  await tick()
  assert.ok(userInput.endsWith(en.combatAdditionalPromptDefault))
})
