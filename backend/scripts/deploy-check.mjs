#!/usr/bin/env node
// Post-deploy gate. Дожидается /health и прогоняет критические проверки.
// Возвращает ненулевой код при провале — годится как шаг CI/CD после деплоя.
//
//   SMOKE_BASE_URL=https://feynmap.example node scripts/deploy-check.mjs
//   (опц.) SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_ORG_SLUG — проверить authed-путь
//   (опц.) SMOKE_TIMEOUT_MS — сколько ждать готовности /health (по умолч. 60000)

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 60000);

const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.error(`  ✗ ${m}`); process.exitCode = 1; };

async function waitHealthy() {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j.ok === true) return true;
      }
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error(`  (последняя ошибка: ${lastErr})`);
  return false;
}

console.log(`deploy-check → ${BASE}`);

if (!(await waitHealthy())) {
  fail(`/health не стал healthy за ${TIMEOUT_MS} мс`);
  process.exit(1);
}
ok('/health = { ok: true }');

// Guard: защищённый маршрут без токена обязан давать 401.
try {
  const r = await fetch(`${BASE}/auth/me`);
  r.status === 401 ? ok('auth-guard: /auth/me без токена → 401') : fail(`/auth/me ожидалось 401, получено ${r.status}`);
} catch (e) { fail(`/auth/me ошибка: ${e.message}`); }

// Опционально — полный путь аутентификации.
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
if (email && password) {
  try {
    const l = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, orgSlug: process.env.SMOKE_ORG_SLUG }),
    });
    if (l.status !== 200) {
      fail(`login → ${l.status}`);
    } else {
      const { token } = await l.json();
      const me = await fetch(`${BASE}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      me.status === 200 ? ok('login → JWT → /auth/me → 200') : fail(`/auth/me с токеном → ${me.status}`);
    }
  } catch (e) { fail(`auth-флоу ошибка: ${e.message}`); }
} else {
  console.log('  • authed-проверки пропущены (нет SMOKE_EMAIL/SMOKE_PASSWORD)');
}

console.log(process.exitCode ? '\ndeploy-check: FAIL' : '\ndeploy-check: OK');
