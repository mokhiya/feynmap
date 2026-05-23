// Express middleware — extracts Bearer token, verifies it, loads the
// user + their roles + permissions fresh from DB on every request.
//
// Why load roles every request instead of caching them in the JWT?
// So an admin revoking a role takes effect immediately. Cost is one
// indexed query per request — cheap, and we can layer Redis later.
//
// On success: `req.user` is set to:
//   {
//     id, orgId, email, fullName, locale, status,
//     roles: [{ id, code, name }],
//     // Map<permissionCode, Set<scope>> — used by requirePermission()
//     permissions: { 'kb.view': Set { 'org' }, ... },
//   }
//
// On failure: 401 with { error }.

import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, userRoles, roles, rolePermissions, permissions } from '../db/schema.js';
import { verifyToken } from './jwt.js';

function extractBearer(req) {
  const h = req.headers.authorization || '';
  if (!h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim() || null;
}

async function loadUserWithRBAC(userId) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  if (user.status !== 'active') return { ...user, _blocked: true };

  const userRoleRows = await db
    .select({ id: roles.id, code: roles.code, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(roles.orgId, user.orgId)));

  const roleIds = userRoleRows.map((r) => r.id);
  let permMap = {};
  if (roleIds.length) {
    const permRows = await db
      .select({ code: permissions.code, scope: rolePermissions.scope })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(rolePermissions.roleId, roleIds));

    for (const { code, scope } of permRows) {
      if (!permMap[code]) permMap[code] = new Set();
      permMap[code].add(scope);
    }
  }

  return {
    id: user.id,
    orgId: user.orgId,
    email: user.email,
    fullName: user.fullName,
    locale: user.locale,
    status: user.status,
    roles: userRoleRows,
    permissions: permMap,
  };
}

export async function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  let claims;
  try {
    claims = verifyToken(token);
  } catch (e) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
  if (!claims?.sub) return res.status(401).json({ error: 'malformed token' });

  let loaded;
  try {
    loaded = await loadUserWithRBAC(claims.sub);
  } catch (e) {
    console.error('[requireAuth] DB error:', e);
    return res.status(500).json({ error: 'auth lookup failed' });
  }
  if (!loaded) return res.status(401).json({ error: 'user not found' });
  if (loaded._blocked) return res.status(403).json({ error: 'user is blocked' });

  // Org claim mismatch = forged token across tenants — refuse.
  if (claims.org && claims.org !== loaded.orgId) {
    return res.status(401).json({ error: 'org claim mismatch' });
  }

  req.user = loaded;
  next();
}

// Re-export so other modules don't reach into requireAuth.js internals.
export { loadUserWithRBAC };
