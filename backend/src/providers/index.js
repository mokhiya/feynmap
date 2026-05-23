// Provider factory. Single source of truth for which LLM / embedder
// is wired up. Selection is env-driven and resolved once at boot —
// flipping `LLM_PROVIDER` from `anthropic` to `local` is a config flip,
// not a code change (Roadmap M1.1 / M4.1).
//
// Usage from anywhere on the backend:
//   import { getLLM, getEmbedder } from './providers/index.js';
//   const { text } = await getLLM().complete({ system, messages, tier: 'student' });

import { AnthropicLLM } from './llm/anthropic.js';
import { OpenAILLM } from './llm/openai.js';
import { LocalLLM } from './llm/local.js';

import { VoyageEmbedding } from './embedding/voyage.js';
import { OpenAIEmbedding } from './embedding/openai.js';
import { LocalEmbedding } from './embedding/local.js';

const LLM_REGISTRY = {
  anthropic: AnthropicLLM,
  openai: OpenAILLM,
  local: LocalLLM,
};

const EMBEDDING_REGISTRY = {
  voyage: VoyageEmbedding,
  openai: OpenAIEmbedding,
  local: LocalEmbedding,
};

let _llm = null;
let _embedder = null;

function buildLLM() {
  const choice = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
  const Cls = LLM_REGISTRY[choice];
  if (!Cls) {
    throw new Error(
      `Unknown LLM_PROVIDER="${choice}". Valid: ${Object.keys(LLM_REGISTRY).join(', ')}`,
    );
  }
  const instance = new Cls();
  console.log(`[providers] LLM = ${instance.name}`);
  return instance;
}

function buildEmbedder() {
  const choice = (process.env.EMBEDDING_PROVIDER || 'voyage').toLowerCase();
  const Cls = EMBEDDING_REGISTRY[choice];
  if (!Cls) {
    throw new Error(
      `Unknown EMBEDDING_PROVIDER="${choice}". Valid: ${Object.keys(EMBEDDING_REGISTRY).join(', ')}`,
    );
  }
  const instance = new Cls();
  console.log(`[providers] Embedder = ${instance.name}`);
  return instance;
}

/** @returns {import('./llm/base.js').LLMProvider} */
export function getLLM() {
  if (!_llm) _llm = buildLLM();
  return _llm;
}

/** @returns {import('./embedding/base.js').EmbeddingProvider} */
export function getEmbedder() {
  if (!_embedder) _embedder = buildEmbedder();
  return _embedder;
}

/** Test-only — drop cached instances so a new env can take effect. */
export function _resetProvidersForTests() {
  _llm = null;
  _embedder = null;
}
