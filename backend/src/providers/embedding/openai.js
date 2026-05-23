// OpenAI embeddings — stub. Wired later if a customer requires it.
//
//   EMBEDDING_PROVIDER=openai
//   EMBEDDING_OPENAI_API_KEY=sk-...
//   EMBEDDING_OPENAI_MODEL=text-embedding-3-small  (1536-dim)

import { EmbeddingProvider } from './base.js';
import { NotImplementedError } from '../llm/base.js';

export class OpenAIEmbedding extends EmbeddingProvider {
  get name() {
    return 'openai';
  }

  async embed() {
    throw new NotImplementedError('OpenAI embedding provider is a stub.');
  }
}
