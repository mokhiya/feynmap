// Voyage AI embeddings — stub for Phase 1. Default cloud embedder per
// resolved decision #2 in CLAUDE.md (voyage-3, Anthropic ecosystem).
// Full impl arrives with Phase 2 (KB ingest); env shape documented here.
//
//   EMBEDDING_PROVIDER=voyage
//   EMBEDDING_VOYAGE_API_KEY=pa-...
//   EMBEDDING_VOYAGE_MODEL=voyage-3        (1024-dim)

import { EmbeddingProvider } from './base.js';
import { NotImplementedError } from '../llm/base.js';

export class VoyageEmbedding extends EmbeddingProvider {
  get name() {
    return 'voyage';
  }

  async embed() {
    throw new NotImplementedError(
      'Voyage embedding provider is a stub. Wired in Phase 2 (KB ingest).',
    );
  }
}
