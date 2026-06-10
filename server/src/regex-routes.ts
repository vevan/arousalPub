import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from './api-error-codes.js'
import { isValidConversationId } from './conversation-id.js'
import {
  parseRegexBatchApplyBody,
  runConversationRegexBatchApply,
} from './regex-batch-apply.js'
import {
  applyRegexRulesToText,
  filterRegexRules,
} from './regex-apply.js'
import {
  REGEX_FIELDS,
  REGEX_PHASES,
  type RegexApplyTextBody,
  type RegexField,
  type RegexPhase,
} from './regex-rules-types.js'
import {
  RegexRulesValidationError,
  normalizeRegexRulesDocument,
  readRegexRulesDocument,
  writeRegexRulesDocument,
} from './regex-rules-file.js'

function isRegexPhase(v: unknown): v is RegexPhase {
  return (
    typeof v === 'string' &&
    (REGEX_PHASES as readonly string[]).includes(v)
  )
}

function isRegexField(v: unknown): v is RegexField {
  return (
    typeof v === 'string' &&
    (REGEX_FIELDS as readonly string[]).includes(v)
  )
}

function parseRegexApplyTextBody(body: unknown): RegexApplyTextBody | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: ApiErrorCodes.invalid_request_body }
  }
  const b = body as Record<string, unknown>
  if (typeof b.text !== 'string') {
    return { error: ApiErrorCodes.regex_apply_text_required }
  }
  if (!isRegexPhase(b.phase)) {
    return { error: ApiErrorCodes.regex_apply_invalid_phase }
  }
  if (!isRegexField(b.field)) {
    return { error: ApiErrorCodes.regex_apply_invalid_field }
  }
  if (
    typeof b.tailOrdinal !== 'number' ||
    !Number.isFinite(b.tailOrdinal) ||
    b.tailOrdinal < 0
  ) {
    return { error: ApiErrorCodes.regex_apply_tail_ordinal_invalid }
  }
  let turnOrdinal: number | undefined
  if (b.turnOrdinal !== undefined) {
    if (
      typeof b.turnOrdinal !== 'number' ||
      !Number.isFinite(b.turnOrdinal) ||
      b.turnOrdinal < 0
    ) {
      return { error: ApiErrorCodes.validation_failed }
    }
    turnOrdinal = Math.trunc(b.turnOrdinal)
  }
  let ruleIds: string[] | 'all' | undefined
  if (b.ruleIds !== undefined) {
    if (b.ruleIds === 'all') {
      ruleIds = 'all'
    } else if (Array.isArray(b.ruleIds)) {
      ruleIds = b.ruleIds.filter((id): id is string => typeof id === 'string')
    } else {
      return { error: ApiErrorCodes.validation_failed }
    }
  }
  return {
    text: b.text,
    phase: b.phase,
    field: b.field,
    turnOrdinal,
    tailOrdinal: Math.trunc(b.tailOrdinal),
    ruleIds,
  }
}

export function registerRegexRoutes(app: FastifyInstance): void {
  app.get('/api/regex-rules', async (_request, reply) => {
    try {
      const doc = await readRegexRulesDocument()
      return doc
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.regex_rules_read_failed })
    }
  })

  app.put('/api/regex-rules', async (request, reply) => {
    const b = request.body
    if (!b || typeof b !== 'object') {
      return reply.status(400).send({ error: ApiErrorCodes.invalid_request_body })
    }
    try {
      const doc = await writeRegexRulesDocument(b)
      return doc
    } catch (e) {
      if (e instanceof RegexRulesValidationError) {
        return reply.status(400).send({ error: ApiErrorCodes.regex_rules_validation_failed })
      }
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.regex_rules_write_failed })
    }
  })

  app.post('/api/regex/apply-text', async (request, reply) => {
    const parsed = parseRegexApplyTextBody(request.body)
    if ('error' in parsed) {
      return reply.status(400).send({ error: parsed.error })
    }
    try {
      const doc = await readRegexRulesDocument()
      const rules = filterRegexRules(doc.rules, {
        phases: [parsed.phase],
        ruleIds: parsed.ruleIds ?? 'all',
      })
      let execTimedOut = false
      const result = applyRegexRulesToText(
        parsed.text,
        rules,
        {
          phase: parsed.phase,
          field: parsed.field,
          turnOrdinal: parsed.turnOrdinal,
          tailOrdinal: parsed.tailOrdinal,
        },
        {
          onRuleError: (rule, err) => {
            if (
              err instanceof Error &&
              err.message === 'regex_exec_timeout'
            ) {
              execTimedOut = true
            }
            app.log.warn({ ruleId: rule.id, err }, 'regex apply-text rule skipped')
          },
        },
      )
      if (execTimedOut) {
        return reply.status(422).send({
          error: ApiErrorCodes.regex_exec_timeout,
          text: parsed.text,
        })
      }
      return {
        text: result,
        appliedRuleCount: rules.filter((r) => r.enabled).length,
      }
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: ApiErrorCodes.regex_rules_read_failed })
    }
  })

  app.post<{ Params: { id: string } }>(
    '/api/chat/conversations/:id/regex/apply',
    async (request, reply) => {
      const id = request.params.id
      if (!isValidConversationId(id)) {
        return reply.status(400).send({ error: ApiErrorCodes.invalid_id })
      }
      const parsed = parseRegexBatchApplyBody(request.body)
      if (!parsed.ok) {
        const code =
          parsed.error in ApiErrorCodes
            ? (parsed.error as (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes])
            : ApiErrorCodes.validation_failed
        return reply.status(400).send({ error: code })
      }
      try {
        const outcome = await runConversationRegexBatchApply(id, parsed.request)
        if (!outcome.ok) {
          return reply.status(outcome.status).send({ error: outcome.error })
        }
        return outcome.result
      } catch (e) {
        request.log.error(e)
        if (e instanceof RegexRulesValidationError) {
          return reply
            .status(400)
            .send({ error: ApiErrorCodes.regex_rules_validation_failed })
        }
        if (e instanceof Error && e.message === 'turns_batch_too_large') {
          return reply.status(400).send({ error: ApiErrorCodes.turns_batch_too_large })
        }
        return reply.status(500).send({ error: ApiErrorCodes.regex_rules_read_failed })
      }
    },
  )
}
