// What one prompt's turn has used so far.
export type PromptTokens = {
  model: string
  // The model's context window, in tokens.
  window: number
  // Context fill when the prompt started.
  before: number
  // Context fill after the latest main-thread response (0 until the first).
  context: number
  // Prompt tokens sent, summed over the turn's requests, and the cached part.
  input: number
  cached: number
  // Tokens generated, summed.
  output: number
  // Estimated tokens of the response streaming right now.
  live: number
  // Main-thread model requests made.
  calls: number
  // Input + output of subagents the turn ran.
  agents: number
  isRunning: boolean
}

export type Active = { turnId: string; isLinked: boolean }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': {
      // By turnId.
      turns: StateFamily<PromptTokens | null>
      // Prompt row uuid -> turnId.
      links: StateFamily<string | null>
      active: Active | null
      // A prompt row appended before its turn started.
      pending: string | null
      // The latest main turn, which the pinned meter shows.
      latest: string | null
    }
  }
}
