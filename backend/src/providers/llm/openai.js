// OpenAI LLM provider — stub. Wired in a later phase; for now the
// abstraction just refuses cleanly so callers aren't tempted to
// short-circuit it. Env shape kept here as documentation:
//
//   LLM_PROVIDER=openai
//   LLM_OPENAI_API_KEY=sk-...
//   LLM_OPENAI_MODEL_STUDENT=gpt-4o
//   LLM_OPENAI_MODEL_ASSESSOR=gpt-4o-mini
//   LLM_OPENAI_BASE_URL=...    (optional, for Azure/custom proxies)

import { LLMProvider, NotImplementedError } from './base.js';

export class OpenAILLM extends LLMProvider {
  get name() {
    return 'openai';
  }

  async complete() {
    throw new NotImplementedError(
      'OpenAI LLM provider is a stub. Set LLM_PROVIDER=anthropic or implement it.',
    );
  }
}
