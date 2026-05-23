// Admin user management.
//
//   GET    /users                    list (org-scoped)
//   POST   /users                    create (email, password, fullName, locale, roleCodes[])
//   GET    /users/:id                fetch one
//   PATCH  /users/:id                update fullName, locale
//   POST   /users/:id/block          status=blocked
//   POST   /users/:id/unblock        status=active
//   POST   /users/:id/password-reset admin sets new password
//   POST   /users/:id/roles          assign role  { roleCode }
//   DELETE /users/:id/roles/:code    revoke role
//
// All endpoints require auth. `user.manage` (org) for CRUD/block.
// `role.assign` (org) for role grants/revokes. Org-scoping is enforced
// on every query — never trust the path.

import { Router } from 'express';
import { and, eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, roles, userRoles } from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission } from '../rbac/requirePermission.js';
import { hashPassword } from '../auth/password.js';
import { audit } from '../auth/audit.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

// ---------- helpers ----------

function serializeUser(u, rolesArr = []) {
  return {
    id: u.id,
    orgId: u.orgId,
    email: u.email,
    fullName: u.fullName,
    locale: u.locale,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    roles: rolesArr.map((r) => ({ code: r.code, name: r.name })),
  };
}

async function fetchUserWithRoles(orgId, userId) {
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.id, userId)))
    .limit(1);
  if (!u) return null;
  const userRoleRows = await db
    .select({ code: roles.code, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return serializeUser(u, userRoleRows);
}

// ---------- GET /users ----------

usersRouter.get('/', requirePermission('user.manage', 'org'), async (req, res) => {
  try {
    const list = await db
      .select()
      .from(users)
      .where(eq(users.orgId, req.user.orgId))
      .orderBy(asc(users.email));

    // Hydrate roles in a single batch query.
    const ids = list.map((u) => u.id);
    let rolesByUser = new Map();
    if (ids.length) {
      const rows = await db
        .select({
          userId: userRoles.userId,
          code: roles.code,
          name: roles.name,
        })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(roles.orgId, req.user.orgId));
      for (const r of rows) {
        if (!rolesByUser.has(r.userId)) rolesByUser.set(r.userId, []);
        rolesByUser.get(r.userId).push({ code: r.code, name: r.name });
      }
    }
    res.json({
      users: list.map((u) => serializeUser(u, rolesByUser.get(u.id) || [])),
    });
  } catch (e) {
    console.error('[GET /users]', e);
    res.status(500).json({ error: 'list failed' });
  }
});

// ---------- POST /users ----------

usersRouter.post('/', requirePermission('user.manage', 'org'), async (req, res) => {
  const { email, password, fullName, locale, roleCodes } = req.body || {};
  if (!email || !password || !fullName) {
    return res.status(400).json({ error: 'email, password, fullName required' });
  }
  const normEmail = String(email).toLowerCase().trim();

  // role.assign required if any roles are being granted at create time.
  const roleList = Array.isArray(roleCodes) ? roleCodes : [];
  if (roleList.length && !canAssignRoles(req)) {
    return res.status(403).json({ error: 'role.assign required to grant roles' });
  }

  try {
    // unique-per-org email
    const [dup] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, req.user.orgId), eq(users.email, normEmail)))
      .limit(1);
    if (dup) return res.status(409).json({ error: 'email already exists' });

    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({
        orgId: req.user.orgId,
        email: normEmail,
        passwordHash,
        fullName: String(fullName).slice(0, 200),
        locale: ['ru', 'en', 'uz'].includes(locale) ? locale : 'ru',
        status: 'active',
      })
      .returning();

    // Assign roles (if any).
    if (roleList.length) {
      const grant = await db
        .select()
        .from(roles)
        .where(eq(roles.orgId, req.user.orgId));
      const codeToRole = new Map(grant.map((r) => [r.code, r]));
      for (const code of roleList) {
        const r = codeToRole.get(code);
        if (!r) continue;
        await db
          .insert(userRoles)
          .values({ userId: created.id, roleId: r.id, assignedBy: req.user.id })
          .onConflictDoNothing();
      }
    }

    await audit({
      req, orgId: req.user.orgId, actorUserId: req.user.id,
      action: 'user.create', targetType: 'user', targetId: created.id,
      meta: { email: normEmail, roles: roleList },
    });

    const payload = await fetchUserWithRoles(req.user.orgId, created.id);
    res.status(201).json({ user: payload });
  } catch (e) {
    console.error('[POST /users]', e);
    res.status(500).json({ error: 'create failed' });
  }
});

// ---------- GET /users/:id ----------

usersRouter.get('/:id', requirePermission('user.manage', 'org'), async (req, res) => {
  const u = await fetchUserWithRoles(req.user.orgId, req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({ user: u });
});

// ---------- PATCH /users/:id ----------

usersRouter.patch('/:id', requirePermission('user.manage', 'org'), async (req, res) => {
  const { fullName, locale } = req.body || {};
  const patch = { updatedAt: new Date() };
  if (typeof fullName === 'string') patch.fullName = fullName.slice(0, 200);
  if (locale && ['ru', 'en', 'uz'].includes(locale)) patch.locale = locale;
  if (Object.keys(patch).length === 1) {
    return res.status(400).json({ error: 'nothing to update' });
  }

  const result = await db
    .update(users)
    .set(patch)
    .where(and(eq(users.orgId, req.user.orgId), eq(users.id, req.params.id)))
    .returning({ id: users.id });
  if (!result.length) return res.status(404).json({ error: 'not found' });

  await audit({
    req, orgId: req.user.orgId, actorUserId: req.user.id,
    action: 'user.update', targetType: 'user', targetId: req.params.id,
    meta: { fields: Object.keys(patch).filter((k) => k !== 'updatedAt') },
  });
  const u = await fetchUserWithRoles(req.user.orgId, req.params.id);
  res.json({ user: u });
});

// ---------- block / unblock ----------

usersRouter.post(
  '/:id/block',
  requirePermission('user.manage', 'org'),
  async (req, res) => setStatus(req, res, 'blocked', 'user.block'),
);
usersRouter.post(
  '/:id/unblock',
  requirePermission('user.manage', 'org'),
  async (req, res) => setStatus(req, res, 'active', 'user.unblock'),
);

async function setStatus(req, res, status, action) {
  if (req.user.id === req.params.id) {
    return res.status(400).json({ error: 'cannot change own status' });
  }
  const result = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(users.orgId, req.user.orgId), eq(users.id, req.params.id)))
    .returning({ id: users.id });
  if (!result.length) return res.status(404).json({ error: 'not found' });
  await audit({
    req, orgId: req.user.orgId, actorUserId: req.user.id,
    action, targetType: 'user', targetId: req.params.id,
  });
  res.json({ ok: true });
}

// ---------- password reset (admin sets new) ----------

usersRouter.post(
  '/:id/password-reset',
  requirePermission('user.manage', 'org'),
  async (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'password must be >= 8 chars' });
    }
    const passwordHash = await hashPassword(password);
    const result = await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(users.orgId, req.user.orgId), eq(users.id, req.params.id)))
      .returning({ id: users.id });
    if (!result.length) return res.status(404).json({ error: 'not found' });
    await audit({
      req, orgId: req.user.orgId, actorUserId: req.user.id,
      action: 'user.password_reset', targetType: 'user', targetId: req.params.id,
      meta: { by: 'admin' },
    });
    res.json({ ok: true });
  },
);

// ---------- role assign / revoke ----------

function canAssignRoles(req) {
  const s = req.user?.permissions?.['role.assign'];
  return !!s && s.has('org');
}

usersRouter.post(
  '/:id/roles',
  requirePermission('role.assign', 'org'),
  async (req, res) => {
    const { roleCode } = req.body || {};
    if (!roleCode) return res.status(400).json({ error: 'roleCode required' });

    // Target must be in caller's org.
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, req.user.orgId), eq(users.id, req.params.id)))
      .limit(1);
    if (!target) return res.status(404).json({ error: 'user not found' });

    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.orgId, req.user.orgId), eq(roles.code, roleCode)))
      .limit(1);
    if (!role) return res.status(404).json({ error: 'role not found' });

    await db
      .insert(userRoles)
      .values({ userId: target.id, roleId: role.id, assignedBy: req.user.id })
      .onConflictDoNothing();

    await audit({
      req, orgId: req.user.orgId, actorUserId: req.user.id,
      action: 'role.assign', targetType: 'user', targetId: target.id,
      meta: { roleCode },
    });
    const u = await fetchUserWithRoles(req.user.orgId, target.id);
    res.json({ user: u });
  },
);

usersRouter.delete(
  '/:id/roles/:code',
  requirePermission('role.assign', 'org'),
  async (req, res) => {
    const [target] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, req.user.orgId), eq(users.id, req.params.id)))
      .limit(1);
    if (!target) return res.status(404).json({ error: 'user not found' });

    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.orgId, req.user.orgId), eq(roles.code, req.params.code)))
      .limit(1);
    if (!role) return res.status(404).json({ error: 'role not found' });

    await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, target.id), eq(userRoles.roleId, role.id)));

    await audit({
      req, orgId: req.user.orgId, actorUserId: req.user.id,
      action: 'role.revoke', targetType: 'user', targetId: target.id,
      meta: { roleCode: req.params.code },
    });
    const u = await fetchUserWithRoles(req.user.orgId, target.id);
    res.json({ user: u });
  },
);
