// Anthropic LLM provider — Claude Sonnet (student tier) + Haiku
// (assessor tier). All previous direct `client.messages.create()` calls
// from server.js are funneled through here.

import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from './base.js';

const DEFAULT_STUDENT_MODEL =
  process.env.LLM_ANTHROPIC_MODEL_STUDENT || 'claude-sonnet-4-6';
const DEFAULT_ASSESSOR_MODEL =
  process.env.LLM_ANTHROPIC_MODEL_ASSESSOR || 'claude-haiku-4-5-20251001';
const DEFAULT_FALLBACK_MODEL = DEFAULT_STUDENT_MODEL;

export class AnthropicLLM extends LLMProvider {
  constructor(config = {}) {
    super(config);
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    this.client = new Anthropic({ apiKey });
  }

  get name() {
    return 'anthropic';
  }

  /**
   * @param {string|undefined} explicitModel
   * @param {import('./base.js').Tier|undefined} tier
   */
  resolveModel(explicitModel, tier) {
    if (explicitModel) return explicitModel;
    if (tier === 'assessor') return DEFAULT_ASSESSOR_MODEL;
    if (tier === 'student') return DEFAULT_STUDENT_MODEL;
    return DEFAULT_FALLBACK_MODEL;
  }

  async complete({
    system = '',
    messages,
    tier,
    model,
    maxTokens = 1024,
    temperature,
    cache,
    signal,
  }) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('LLM.complete: messages must be a non-empty array');
    }

    const chosen = this.resolveModel(model, tier);

    // System prompt is sent as a single ephemeral-cached text block — this
    // is the same prompt-caching pattern the previous server.js used.
    const systemBlocks = system
      ? [
          {
            type: 'text',
            text: system,
            ...(cache?.ephemeral !== false
              ? { cache_control: { type: 'ephemeral' } }
              : {}),
          },
        ]
      : undefined;

    const req = {
      model: chosen,
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemBlocks) req.system = systemBlocks;
    if (typeof temperature === 'number') req.temperature = temperature;

    const resp = await this.client.messages.create(req, signal ? { signal } : undefined);

    const text = (resp.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return {
      text,
      model: chosen,
      provider: this.name,
      usage: {
        inputTokens: resp.usage?.input_tokens,
        outputTokens: resp.usage?.output_tokens,
      },
    };
  }
}
