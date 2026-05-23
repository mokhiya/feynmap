// Local embeddings via Ollama (bge-m3, 1024-dim, multilingual).
//
// Ollama exposes both a native API (/api/embed, /api/embeddings) and an
// OpenAI-compatible /v1/embeddings. We hit the native /api/embed because
// it accepts a batch in one round-trip and returns the cleanest shape.
//
//   EMBEDDING_PROVIDER=local
//   EMBEDDING_LOCAL_BASE_URL=http://localhost:11434
//   EMBEDDING_LOCAL_MODEL=bge-m3
//
// bge-m3 is a multilingual model (100+ langs incl. ru/en/uz) sized for
// RAG, output is 1024-dim float vectors → pgvector column vector(1024).

import { EmbeddingProvider } from './base.js';

const DEFAULT_BASE = 'http://localhost:11434';
const DEFAULT_MODEL = 'bge-m3';

export class LocalEmbedding extends EmbeddingProvider {
  constructor(config = {}) {
    super(config);
    this.baseUrl = (
      config.baseUrl ||
      process.env.EMBEDDING_LOCAL_BASE_URL ||
      DEFAULT_BASE
    ).replace(/\/+$/, '');
    this.model =
      config.model || process.env.EMBEDDING_LOCAL_MODEL || DEFAULT_MODEL;
  }

  get name() {
    return `local(${this.model})`;
  }

  /**
   * @param {string[]} texts
   * @returns {Promise<import('./base.js').EmbedResult>}
   */
  async embed(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return {
        vectors: [],
        dimensions: 0,
        model: this.model,
        provider: 'local',
      };
    }
    const url = `${this.baseUrl}/api/embed`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `LocalEmbedding HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`,
      );
    }
    const json = await res.json();
    // Ollama /api/embed returns { embeddings: number[][], model, ... }
    const vectors = json.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      throw new Error(
        `LocalEmbedding unexpected shape: got ${vectors?.length} vectors for ${texts.length} inputs`,
      );
    }
    return {
      vectors,
      dimensions: vectors[0]?.length || 0,
      model: this.model,
      provider: 'local',
      usage: {
        totalTokens:
          (json.prompt_eval_count ?? 0) || undefined,
      },
    };
  }
}
