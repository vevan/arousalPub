export class AgentSettingsValidationError extends Error {
  constructor(
    message: string,
    readonly code = 'agent_settings_validation_failed',
  ) {
    super(message)
    this.name = 'AgentSettingsValidationError'
  }
}
