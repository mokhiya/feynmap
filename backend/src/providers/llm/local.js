// Local LLM provider — vLLM / Ollama / any OpenAI-compatible server.
// Stub for now; full impl arrives with Roadmap M4.1 (Qwen 32B–72B
// served via vLLM, on-prem).
//
// Env contract (target):
//   LLM_PROVIDER=local
//   LLM_LOCAL_BASE_URL=http://localhost:8000/v1
//   LLM_LOCAL_API_KEY=...           (some servers require any string)
//   LLM_LOCAL_MODEL=Qwen/Qwen2.5-32B-Instruct
//   LLM_LOCAL_MODEL_STUDENT=...     (optional, override per tier)
//   LLM_LOCAL_MODEL_ASSESSOR=...

import { LLMProvider, NotImplementedError } from './base.js';

export class LocalLLM extends LLMProvider {
  get name() {
    return 'local';
  }

  async complete() {
    throw new NotImplementedError(
      'Local LLM provider is a stub. Implement in M4.1 (vLLM/Ollama via OpenAI-compatible API).',
    );
  }
}
