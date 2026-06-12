#!/usr/bin/env node
/**
 * 用法: tsx scripts/import-st-preset.ts <st-preset.json> [output.json] [--name "Preset name"]
 * 未指定 output 时写入 stdout。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { assemblePrompts } from '../src/assemble-prompts.js'
import { formatFilenameAsPresetName } from '../src/st-preset-detect.js'
import { convertStPresetToArousalPub } from '../src/st-preset-import.js'

const argv = process.argv.slice(2)
let inputPath = argv[0]
let outputPath: string | undefined
let presetName: string | undefined

for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--name' && argv[i + 1]) {
    presetName = argv[++i]
  } else if (!outputPath && !argv[i]?.startsWith('--')) {
    outputPath = argv[i]
  }
}

if (!inputPath) {
  console.error(
    'Usage: tsx scripts/import-st-preset.ts <st-preset.json> [output.json] [--name "Preset name"]',
  )
  process.exit(1)
}

const raw = JSON.parse(readFileSync(resolve(inputPath), 'utf8'))
const preset = convertStPresetToArousalPub(raw, {
  presetId: 'preset-stabs-import',
  presetName:
    presetName ?? formatFilenameAsPresetName(basename(inputPath)),
})

const json = JSON.stringify(preset, null, 2)
if (outputPath) {
  const out = resolve(outputPath)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, json, 'utf8')
  console.error(`Wrote ${outputPath}`)
} else {
  process.stdout.write(json)
}

const preview = assemblePrompts(preset, {
  character: '[character]',
  characterPostHistory: '[post]',
  world: '[world]',
  history: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ],
  userInput: 'current turn',
})
console.error(
  `Preview: ${preview.messages.length} messages, ~${preview.estimatedTokens} tokens`,
)
console.error(
  'First 5:',
  preview.messages.slice(0, 5).map((m) => `${m.role}: ${m.content.slice(0, 60)}…`),
)
console.error(
  'Last 5:',
  preview.messages.slice(-5).map((m) => `${m.role}: ${m.content.slice(0, 60)}…`),
)
