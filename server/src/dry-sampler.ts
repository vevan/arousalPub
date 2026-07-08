export interface DrySamplerBodyFields {
  dryMultiplier?: number | null
  dryBase?: number | null
  dryAllowedLength?: number | null
  dryPenaltyLastN?: number | null
  drySequenceBreakers?: string[] | null
}

export function appendDrySamplerToPayload(
  payload: Record<string, unknown>,
  body: DrySamplerBodyFields,
): void {
  const {
    dryMultiplier,
    dryBase,
    dryAllowedLength,
    dryPenaltyLastN,
    drySequenceBreakers,
  } = body

  if (dryMultiplier !== undefined && dryMultiplier !== null) {
    payload.dry_multiplier = dryMultiplier
  }
  if (dryBase !== undefined && dryBase !== null) {
    payload.dry_base = dryBase
  }
  if (dryAllowedLength !== undefined && dryAllowedLength !== null) {
    payload.dry_allowed_length = dryAllowedLength
  }
  if (dryPenaltyLastN !== undefined && dryPenaltyLastN !== null) {
    payload.dry_penalty_last_n = dryPenaltyLastN
  }
  if (
    Array.isArray(drySequenceBreakers) &&
    drySequenceBreakers.length > 0
  ) {
    payload.dry_sequence_breakers = drySequenceBreakers
  }
}
