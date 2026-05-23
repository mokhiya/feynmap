// LLMProvider — the only allowed entrypoint to a chat model from
// FeynMap business logic. See CLAUDE.md Conventions + Roadmap M1.1.
//
// Rules:
//   - No direct SDK calls (`client.messages.create()`, `openai.chat...`)
//     anywhere outside this directory.
//   - Pick a provider once at boot via env (LLM_PROVIDER), and swap to
//     a local on-prem stack later (M4.1) by flipping that one variable.
//   - The interface is the same for cloud and local — callers don't
//     know which one is wired.

/**
 * @typedef {Object} Message
 * @property {'user'|'assistant'} role
 * @property {string} content
 */

/**
 * Optional `tier` hints which capability bucket a call needs. Providers
 * map the tier to a concrete model — Anthropic maps 'student' to Sonnet
 * and 'assessor' to Haiku, OpenAI would map to gpt-4o vs gpt-4o-mini,
 * a local stack might serve both with the same Qwen instance. If an
 * explicit `model` is passed, it wins.
 *
 * @typedef {'student'|'assessor'} Tier
 */

/**
 * @typedef {Object} CompleteParams
 * @property {string} system               System prompt. May be empty.
 * @property {Message[]} messages          Conversation (alternating roles).
 * @property {Tier} [tier]                 Capability hint; provider picks model.
 * @property {string} [model]              Hard override of the model id.
 * @property {number} [maxTokens=1024]
 * @property {number} [temperature]
 * @property {Object} [cache]              { ephemeral?: boolean } for prompt caching
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} CompleteResult
 * @property {string} text                 Assistant message text (joined).
 * @property {string} model                Concrete model id used.
 * @property {{ inputTokens?: number, outputTokens?: number }} [usage]
 * @property {string} provider             Provider name, e.g. 'anthropic'.
 */

export class LLMProvider {
  /** @param {Object} [config] */
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * @param {CompleteParams} _params
   * @returns {Promise<CompleteResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async complete(_params) {
    throw new Error(
      `${this.constructor.name}.complete() is not implemented`,
    );
  }

  /** Human-readable provider id. Override in subclasses. */
  get name() {
    return 'base';
  }
}

/** Thrown when a stub provider is invoked. Surfaces as 501 to clients. */
export class NotImplementedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotImplementedError';
    this.status = 501;
  }
}
