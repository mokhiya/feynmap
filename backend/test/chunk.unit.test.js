// Unit — RAG chunker. Чистая функция, без БД/сети. Всегда выполняется.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../src/rag/chunk.js';

test('пустой вход → []', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText(null), []);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('короткий текст → один чанк с ненулевыми токенами', () => {
  const out = chunkText('Короткий абзац про TCP handshake.');
  assert.equal(out.length, 1);
  assert.match(out[0].text, /TCP/);
  assert.ok(out[0].tokens > 0);
});

test('длинный текст → несколько чанков, каждый в разумном бюджете токенов', () => {
  const big = Array.from({ length: 60 }, (_, i) => `Абзац номер ${i} про энтропию и термодинамику. `.repeat(6)).join('\n\n');
  const out = chunkText(big);
  assert.ok(out.length > 1, 'ожидалось несколько чанков');
  for (const c of out) assert.ok(c.tokens <= 1100, `чанк ${c.tokens} токенов великоват`);
});

test('мультиязычность ru/en/uz не падает', () => {
  const t = 'Hello world. Privet. Salom dunyo.\n\n' + 'Ещё один абзац. '.repeat(40);
  const out = chunkText(t);
  assert.ok(out.length >= 1);
  assert.ok(out.every((c) => typeof c.text === 'string' && c.text.length > 0));
});
