import type { MacroHandler } from '../types.js'
import { expandAuthorsNoteMacros } from './authors-note.js'
import { expandConnectionMacros } from './connection.js'
import { expandDatetimeMacros } from './datetime.js'
import { expandNewlineMacros } from './newline.js'
import { expandUserCharMacros } from './user-char.js'
import { replaceUnsetMacroPlaceholders } from './unset.js'

/** 按顺序执行；`unset` 必须最后 */
export const MACRO_HANDLERS: MacroHandler[] = [
  expandUserCharMacros,
  expandDatetimeMacros,
  expandConnectionMacros,
  expandNewlineMacros,
  expandAuthorsNoteMacros,
  replaceUnsetMacroPlaceholders,
]
