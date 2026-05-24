// Unit — provider-абстракция. Гоним на стаб-провайдере 'local' → ни ключа,
// ни сети не требуется. Проверяем, что фабрика резолвит по ENV и что
// нереализованные провайдеры падают предсказуемо (501).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER = 'local';
process.env.EMBEDDING_PROVIDER = 'local';

const { getLLM, getEmbedder, _resetProvidersForTests } = await import('../src/providers/index.js');

test('фабрика резолвит LLM по ENV (local)', () => {
  _resetProvidersForTests();
  assert.equal(getLLM().name, 'local');
});

test('стаб local LLM падает NotImplementedError со статусом 501', async () => {
  const llm = getLLM();
  await assert.rejects(
    () => llm.complete({ messages: [{ role: 'user', content: 'x' }] }),
    (e) => e?.status === 501,
  );
});

test('фабрика резолвит эмбеддер (local → bge-m3 в имени)', () => {
  _resetProvidersForTests();
  assert.match(getEmbedder().name, /local/);
});

test('неизвестный LLM_PROVIDER → понятная ошибка с перечнем валидных', () => {
  _resetProvidersForTests();
  process.env.LLM_PROVIDER = 'definitely-not-a-provider';
  assert.throws(() => getLLM(), /Unknown LLM_PROVIDER/);
  // вернуть валидное значение, чтобы не аффектить другие тест-файлы
  process.env.LLM_PROVIDER = 'local';
  _resetProvidersForTests();
});
