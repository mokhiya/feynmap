// EmbeddingProvider — the only allowed entrypoint for vector embeddings.
// Same rule as LLMProvider: no direct SDK calls outside this dir.
//
// Wired into the RAG pipeline in Phase 2 (KB ingest). Phase 1 just
// declares the interface so the abstraction lands as part of the
// foundation — Roadmap M1.1.

/**
 * @typedef {Object} EmbedResult
 * @property {number[][]} vectors       Batch of embeddings (same order as input).
 * @property {number} dimensions        Vector dimensionality (e.g. 1024 for voyage-3).
 * @property {string} model             Concrete model id used.
 * @property {string} provider          Provider name, e.g. 'voyage'.
 * @property {{ totalTokens?: number }} [usage]
 */

export class EmbeddingProvider {
  /** @param {Object} [config] */
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * @param {string[]} _texts
   * @returns {Promise<EmbedResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async embed(_texts) {
    throw new Error(
      `${this.constructor.name}.embed() is not implemented`,
    );
  }

  get name() {
    return 'base';
  }
}
