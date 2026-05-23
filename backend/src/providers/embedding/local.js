// Local embeddings — BGE-m3 via Ollama / vLLM. Target stack per
// Roadmap M4.1. Stub for now.
//
//   EMBEDDING_PROVIDER=local
//   EMBEDDING_LOCAL_BASE_URL=http://localhost:11434/v1
//   EMBEDDING_LOCAL_API_KEY=ollama          (placeholder, Ollama ignores)
//   EMBEDDING_LOCAL_MODEL=bge-m3            (1024-dim)

import { EmbeddingProvider } from './base.js';
import { NotImplementedError } from '../llm/base.js';

export class LocalEmbedding extends EmbeddingProvider {
  get name() {
    return 'local';
  }

  async embed() {
    throw new NotImplementedError(
      'Local embedding provider is a stub. Implement in M4.1 (BGE-m3 via Ollama).',
    );
  }
}
