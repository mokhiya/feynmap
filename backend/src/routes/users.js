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

// ---------- POST /users/import (CSV bulk import) ----------
//
// Accepts either:
//   - JSON  { csv: "email,fullName,password,roleCode,locale\n..." }
//   - JSON  { rows: [{ email, fullName, password, roleCode, locale }] }
//
// Header row is required when sending CSV. Recognised columns (any order):
//   email | fullName | password | roleCode | locale
//
// Behaviour:
//   - Per-row try/catch. Returns a summary { created, skipped, failed, errors[] }.
//   - Duplicate emails are skipped (not failures).
//   - Role grants need role.assign; without it, roleCode column is ignored.
//   - All successful creations + the import event itself are audited.

function parseCsv(text) {
  // RFC 4180-light: comma delimiter, "double-quoted" with "" as literal quote.
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // tail
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // strip fully-empty rows
  return rows.filter((r) => r.some((c) => String(c).trim().length > 0));
}

function rowsFromCsv(text) {
  const grid = parseCsv(text);
  if (grid.length === 0) return [];
  const header = grid[0].map((h) => String(h).trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    out.push({
      email: idx('email') >= 0 ? row[idx('email')] : '',
      fullName: idx('fullname') >= 0 ? row[idx('fullname')] : '',
      password: idx('password') >= 0 ? row[idx('password')] : '',
      roleCode: idx('rolecode') >= 0 ? row[idx('rolecode')] : '',
      locale: idx('locale') >= 0 ? row[idx('locale')] : '',
    });
  }
  return out;
}

usersRouter.post(
  '/import',
  requirePermission('user.manage', 'org'),
  async (req, res) => {
    try {
      const body = req.body || {};
      const sourceRows = Array.isArray(body.rows)
        ? body.rows
        : typeof body.csv === 'string'
          ? rowsFromCsv(body.csv)
          : [];
      if (!sourceRows.length)
        return res.status(400).json({ error: 'csv or rows required' });

      const canRoles = canAssignRoles(req);

      // Preload roles once for role.assign mapping.
      const orgRoles = await db
        .select()
        .from(roles)
        .where(eq(roles.orgId, req.user.orgId));
      const codeToRole = new Map(orgRoles.map((r) => [r.code, r]));

      const summary = { created: 0, skipped: 0, failed: 0, errors: [] };
      const createdIds = [];

      for (let n = 0; n < sourceRows.length; n++) {
        const raw = sourceRows[n] || {};
        const email = String(raw.email || '').toLowerCase().trim();
        const fullName = String(raw.fullName || '').trim();
        const password = String(raw.password || '').trim();
        const localeRaw = String(raw.locale || 'ru').trim();
        const locale = ['ru', 'en', 'uz'].includes(localeRaw) ? localeRaw : 'ru';
        const roleCode = String(raw.roleCode || '').trim();

        if (!email || !fullName || !password) {
          summary.failed += 1;
          summary.errors.push({
            row: n + 1,
            email,
            reason: 'missing email/fullName/password',
          });
          continue;
        }

        try {
          const [dup] = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.orgId, req.user.orgId), eq(users.email, email)))
            .limit(1);
          if (dup) {
            summary.skipped += 1;
            continue;
          }

          const passwordHash = await hashPassword(password);
          const [created] = await db
            .insert(users)
            .values({
              orgId: req.user.orgId,
              email,
              passwordHash,
              fullName: fullName.slice(0, 200),
              locale,
              status: 'active',
            })
            .returning();
          createdIds.push(created.id);

          if (roleCode && canRoles) {
            const r = codeToRole.get(roleCode);
            if (r) {
              await db
                .insert(userRoles)
                .values({
                  userId: created.id,
                  roleId: r.id,
                  assignedBy: req.user.id,
                })
                .onConflictDoNothing();
            }
          }

          summary.created += 1;
        } catch (e) {
          summary.failed += 1;
          summary.errors.push({
            row: n + 1,
            email,
            reason: String(e?.message || e).slice(0, 200),
          });
        }
      }

      await audit({
        req,
        orgId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'user.import',
        targetType: 'user',
        targetId: null,
        meta: {
          ...summary,
          totalRows: sourceRows.length,
          createdIds,
          roleAssignAllowed: canRoles,
        },
      });

      res.json(summary);
    } catch (e) {
      console.error('[POST /users/import]', e);
      res.status(500).json({ error: 'import failed' });
    }
  },
);

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
