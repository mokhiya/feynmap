// Auth routes: POST /auth/login, GET /auth/me, POST /auth/logout.
//
// Logout in a stateless JWT world is a no-op on the server — clients
// drop the token. We still expose it for AuditLog and a clean API
// surface. (When/if we add refresh-token revocation, this endpoint
// becomes the place to invalidate.)

import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, organizations } from '../db/schema.js';
import { verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth, loadUserWithRBAC } from '../auth/requireAuth.js';
import { audit } from '../auth/audit.js';

export const authRouter = Router();

// ---------- POST /auth/login ----------
//
// Body: { email, password, orgSlug? }
//   orgSlug is optional in single-org runtime; required once we host
//   multiple tenants on one URL.

authRouter.post('/login', async (req, res) => {
  const { email, password, orgSlug } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  // Resolve org. If orgSlug omitted and there is exactly one org in DB,
  // use it. Otherwise require explicit slug.
  let orgId = null;
  if (orgSlug) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);
    if (!org) return res.status(401).json({ error: 'invalid credentials' });
    orgId = org.id;
  } else {
    const allOrgs = await db.select({ id: organizations.id }).from(organizations).limit(2);
    if (allOrgs.length === 1) orgId = allOrgs[0].id;
    else return res.status(400).json({ error: 'orgSlug required' });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.email, email.toLowerCase())))
    .limit(1);

  // Generic error message — don't leak whether the email exists.
  const FAIL = { status: 401, body: { error: 'invalid credentials' } };

  if (!user) {
    await audit({
      req, orgId, action: 'auth.login_failed',
      targetType: 'email', targetId: email,
      meta: { reason: 'user_not_found' },
    });
    return res.status(FAIL.status).json(FAIL.body);
  }
  if (user.status !== 'active') {
    await audit({
      req, orgId, actorUserId: user.id, action: 'auth.login_failed',
      targetType: 'user', targetId: user.id,
      meta: { reason: `status:${user.status}` },
    });
    return res.status(FAIL.status).json(FAIL.body);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await audit({
      req, orgId, actorUserId: user.id, action: 'auth.login_failed',
      targetType: 'user', targetId: user.id,
      meta: { reason: 'bad_password' },
    });
    return res.status(FAIL.status).json(FAIL.body);
  }

  // Update last_login_at (best effort).
  try {
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
  } catch (e) {
    console.warn('[auth/login] lastLoginAt update failed:', e?.message);
  }

  const token = signToken({ userId: user.id, orgId: user.orgId });

  await audit({
    req, orgId, actorUserId: user.id, action: 'auth.login',
    targetType: 'user', targetId: user.id,
  });

  // Shape response with the same `me` payload so the client can
  // hydrate auth state from a single response.
  const me = await loadUserWithRBAC(user.id);
  return res.json({
    token,
    user: serializeMe(me),
  });
});

// ---------- GET /auth/me ----------

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: serializeMe(req.user) });
});

// ---------- POST /auth/logout ----------

authRouter.post('/logout', requireAuth, async (req, res) => {
  await audit({
    req,
    orgId: req.user.orgId,
    actorUserId: req.user.id,
    action: 'auth.logout',
    targetType: 'user',
    targetId: req.user.id,
  });
  res.json({ ok: true });
});

// ---------- helpers ----------

function serializeMe(u) {
  if (!u) return null;
  return {
    id: u.id,
    orgId: u.orgId,
    email: u.email,
    fullName: u.fullName,
    locale: u.locale,
    status: u.status,
    roles: u.roles.map((r) => ({ code: r.code, name: r.name })),
    // Convert Set → array for JSON.
    permissions: Object.fromEntries(
      Object.entries(u.permissions || {}).map(([code, set]) => [code, [...set]]),
    ),
  };
}
