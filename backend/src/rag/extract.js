// Plain-text extraction from uploaded documents.
//
// Supported MIME types (Phase 2):
//   application/pdf                                                  → pdf-parse
//   application/vnd.openxmlformats-officedocument.wordprocessingml.document → mammoth
//   text/markdown, text/plain                                        → utf8

import { promises as fs } from 'node:fs';
// pdf-parse v2 exports a class PDFParse (NOT a default function — that
// was v1.x). Construct with { data: buffer }, then `.getText()`.
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export const SUPPORTED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
]);

export const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export function detectMime(originalName, providedMime) {
  if (providedMime && SUPPORTED_MIME.has(providedMime)) return providedMime;
  const lower = (originalName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  return providedMime || 'application/octet-stream';
}

/**
 * @param {string} filePath
 * @param {string} mime
 * @returns {Promise<string>}
 */
export async function extractText(filePath, mime) {
  if (mime === 'application/pdf') {
    const buf = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      // Result has both a concatenated `.text` and per-page `.pages[]`.
      // Concatenate manually with form-feeds so we keep page boundaries.
      if (Array.isArray(result.pages) && result.pages.length) {
        return result.pages.map((p) => p.text).join('\n\n');
      }
      return result.text || '';
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (
    mime ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const buf = await fs.readFile(filePath);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value || '';
  }
  if (mime === 'text/markdown' || mime === 'text/plain') {
    return await fs.readFile(filePath, 'utf8');
  }
  throw new Error(`Unsupported mime: ${mime}`);
}
