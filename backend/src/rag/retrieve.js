// RAG retrieval — fetch top-k chunks for a topic by cosine similarity
// against the query embedding. Used by /sessions/:id/turn and /assess
// to inject «Справочный материал» into Student & Assessor prompts.

import { sql as raw } from '../db/index.js';
import { getEmbedder } from '../providers/index.js';

/**
 * @param {Object} params
 * @param {string} params.orgId      — multi-tenant filter
 * @param {string} [params.topicId]  — restrict to docs linked via topic_documents
 * @param {string} params.query      — natural-language query (last expert utterance + topic)
 * @param {number} [params.k]        — top-k chunks (default 6)
 * @returns {Promise<{chunks: Array<{id, documentId, documentName, chunkIndex, page, heading, text, score}>}>}
 */
export async function retrieveChunks({ orgId, topicId, query, k = 6 }) {
  if (!query || !orgId) return { chunks: [] };

  const { vectors, dimensions } = await getEmbedder().embed([query]);
  if (!vectors[0] || !dimensions) return { chunks: [] };
  const vec = `[${vectors[0].join(',')}]`;

  // Cosine distance operator <=> in pgvector. Smaller = closer; convert
  // to a 0..1 similarity score for downstream display.
  const rows = topicId
    ? await raw`
        SELECT
          c.id, c.document_id, c.chunk_index, c.page, c.heading, c.text,
          d.name AS document_name,
          1 - (c.embedding <=> ${vec}::vector) AS score
        FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        JOIN topic_documents td ON td.document_id = d.id
        WHERE td.topic_id = ${topicId}
          AND c.org_id = ${orgId}
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vec}::vector
        LIMIT ${k}
      `
    : await raw`
        SELECT
          c.id, c.document_id, c.chunk_index, c.page, c.heading, c.text,
          d.name AS document_name,
          1 - (c.embedding <=> ${vec}::vector) AS score
        FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.org_id = ${orgId}
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${vec}::vector
        LIMIT ${k}
      `;

  return {
    chunks: rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      documentName: r.document_name,
      chunkIndex: r.chunk_index,
      page: r.page,
      heading: r.heading,
      text: r.text,
      score: Number(r.score) || 0,
    })),
  };
}

/**
 * Format retrieved chunks into a system-prompt block. Multilingual headers.
 */
export function formatReferenceBlock(chunks, lang = 'ru') {
  if (!chunks || chunks.length === 0) return '';
  const H = {
    ru: 'Справочный материал (эталон). Опирайся на него, выявляй противоречия:',
    en: 'Reference material (canonical). Lean on it, surface contradictions:',
    uz: "Asosiy material (etalon). Unga tayan, ziddiyatlarni aniqla:",
  };
  const head = H[lang] || H.ru;
  const body = chunks
    .map((c, i) => {
      const ref = `[#${i + 1} · ${c.documentName}${c.page ? `, p.${c.page}` : ''}${c.heading ? ` · ${c.heading}` : ''}]`;
      return `${ref}\n${c.text.slice(0, 1200)}`;
    })
    .join('\n\n---\n\n');
  return `${head}\n\n${body}`;
}
