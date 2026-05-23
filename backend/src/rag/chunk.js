// Chunker — splits plain text into ~CHUNK_TOKENS-sized pieces with
// CHUNK_OVERLAP tokens of overlap (Phase 2 / Roadmap M2.1).
//
// We approximate tokens as 4 chars (English) / 2.2 chars (mixed Cyrillic).
// Good enough for chunk sizing; the LLM never sees these counts.
//
// Splitting strategy:
//   1. Normalize whitespace.
//   2. Split on blank-line paragraphs.
//   3. Greedy-pack paragraphs into chunks under target size.
//   4. If a single paragraph exceeds target, split on sentences.
//   5. Overlap by carrying the tail of the previous chunk forward.

const CHUNK_TOKENS = 700;    // target ~700 tokens (~600-900 band per CLAUDE.md)
const CHUNK_OVERLAP = 100;   // ~15% overlap
const CHARS_PER_TOKEN = 3.5; // average across ru/en/uz

function approxTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function normalize(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00ad/g, '')         // soft hyphen
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitParagraphs(text) {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function splitSentences(p) {
  // Naive but works on ru/en/uz with .!? + linebreak.
  return p
    .split(/(?<=[.!?…])\s+(?=[A-ZА-ЯЁ«"\d])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string} rawText
 * @returns {{ text: string, tokens: number }[]}
 */
export function chunkText(rawText) {
  const text = normalize(rawText || '');
  if (!text) return [];

  const paras = splitParagraphs(text);
  const out = [];
  let buf = '';
  let bufTokens = 0;

  const flush = () => {
    if (!buf.trim()) return;
    out.push({ text: buf.trim(), tokens: approxTokens(buf) });
    // carry overlap forward
    if (CHUNK_OVERLAP > 0) {
      const tailChars = CHUNK_OVERLAP * CHARS_PER_TOKEN;
      buf = buf.slice(-Math.floor(tailChars));
      bufTokens = approxTokens(buf);
    } else {
      buf = '';
      bufTokens = 0;
    }
  };

  const pushPiece = (piece) => {
    const t = approxTokens(piece);
    if (bufTokens + t > CHUNK_TOKENS && bufTokens > 0) flush();
    buf = buf ? `${buf}\n\n${piece}` : piece;
    bufTokens += t;
    if (bufTokens >= CHUNK_TOKENS) flush();
  };

  for (const para of paras) {
    if (approxTokens(para) > CHUNK_TOKENS) {
      for (const s of splitSentences(para)) pushPiece(s);
    } else {
      pushPiece(para);
    }
  }
  if (buf.trim()) out.push({ text: buf.trim(), tokens: approxTokens(buf) });

  return out;
}
