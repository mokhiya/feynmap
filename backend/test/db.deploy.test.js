// Deploy-sanity для БД. Проверяет, что миграции + seed реально применены
// к целевой базе и pgvector работает. Пропускается, если DATABASE_URL не
// задан или база недоступна (чтобы локальный `node --test` не падал).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';

const URL = process.env.DATABASE_URL;
let sql = null;
let reachable = false;

before(async () => {
  if (!URL) return;
  sql = postgres(URL, { max: 2, prepare: false });
  try {
    await sql`select 1`;
    reachable = true;
  } catch {
    reachable = false;
  }
});

after(async () => {
  if (sql) await sql.end({ timeout: 5 });
});

function gate(t) {
  if (!URL) return t.skip('DATABASE_URL не задан');
  if (!reachable) return t.skip('БД недоступна');
  return null;
}

test('расширения vector + pgcrypto установлены', async (t) => {
  if (gate(t)) return;
  const rows = await sql`select extname from pg_extension where extname in ('vector','pgcrypto')`;
  const names = rows.map((r) => r.extname);
  assert.ok(names.includes('vector'), 'pgvector не установлен');
  assert.ok(names.includes('pgcrypto'), 'pgcrypto не установлен');
});

test('ключевые таблицы существуют', async (t) => {
  if (gate(t)) return;
  const want = [
    'organizations', 'users', 'permissions', 'roles', 'role_permissions',
    'user_roles', 'audit_logs', 'documents', 'document_chunks',
    'topics', 'sessions', 'assessment_results',
  ];
  const rows = await sql`select table_name from information_schema.tables where table_schema='public'`;
  const have = new Set(rows.map((r) => r.table_name));
  for (const tn of want) assert.ok(have.has(tn), `нет таблицы ${tn}`);
});

test('seed применён: 16 прав, ≥6 ролей, матрица грантов непуста', async (t) => {
  if (gate(t)) return;
  const [{ count: perms }] = await sql`select count(*)::int as count from permissions`;
  assert.ok(perms >= 16, `permissions=${perms} (<16)`);
  const [{ count: rolec }] = await sql`select count(*)::int as count from roles`;
  assert.ok(rolec >= 6, `roles=${rolec} (<6)`);
  const [{ count: rp }] = await sql`select count(*)::int as count from role_permissions`;
  assert.ok(rp > 0, 'role_permissions пуста');
});

test('pgvector: cosine-дистанция одинаковых векторов ≈ 0', async (t) => {
  if (gate(t)) return;
  const [{ d }] = await sql`select ('[1,0,0]'::vector <=> '[1,0,0]'::vector) as d`;
  assert.ok(Number(d) < 1e-6, `ожидалось ~0, получено ${d}`);
});

test('document_chunks.embedding имеет тип vector', async (t) => {
  if (gate(t)) return;
  const rows = await sql`
    select udt_name from information_schema.columns
    where table_name='document_chunks' and column_name='embedding'`;
  assert.ok(rows.length === 1, 'колонка embedding не найдена');
  assert.equal(rows[0].udt_name, 'vector');
});
