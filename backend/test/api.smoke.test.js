// HTTP smoke против РАЗВЁРНУТОГО сервера (post-deploy). Бьёт по реальным
// эндпоинтам. Пропускается, если сервер недоступен по SMOKE_BASE_URL,
// чтобы локальный `node --test` без поднятого бэка не падал.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
let up = false;

before(async () => {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    up = r.ok;
  } catch {
    up = false;
  }
});

test('GET /health → 200 { ok: true }', async (t) => {
  if (!up) return t.skip(`сервер недоступен: ${BASE}`);
  const r = await fetch(`${BASE}/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('защищённый маршрут без токена → 401', async (t) => {
  if (!up) return t.skip('сервер недоступен');
  const r = await fetch(`${BASE}/auth/me`);
  assert.equal(r.status, 401);
});

test('логин с неверными кредами → 400/401, без утечки существования', async (t) => {
  if (!up) return t.skip('сервер недоступен');
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-пароль' }),
  });
  assert.ok([400, 401].includes(r.status), `ожидалось 400/401, получено ${r.status}`);
});

test('полный флоу login → JWT → /auth/me (если заданы SMOKE_EMAIL/PASSWORD)', async (t) => {
  if (!up) return t.skip('сервер недоступен');
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) return t.skip('SMOKE_EMAIL/SMOKE_PASSWORD не заданы');

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, orgSlug: process.env.SMOKE_ORG_SLUG }),
  });
  assert.equal(login.status, 200, 'логин не прошёл');
  const { token, user } = await login.json();
  assert.ok(token, 'нет токена в ответе');
  assert.ok(Array.isArray(user.roles), 'нет ролей в payload');

  const me = await fetch(`${BASE}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.user.email, email.toLowerCase());

  const bad = await fetch(`${BASE}/auth/me`, { headers: { authorization: 'Bearer not.a.jwt' } });
  assert.equal(bad.status, 401, 'битый токен должен давать 401');
});
