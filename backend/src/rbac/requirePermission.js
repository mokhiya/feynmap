// RBAC middleware factory.
//
// Usage:
//   router.get('/users', requireAuth, requirePermission('user.manage', 'org'), handler);
//
// Scope semantics:
//   own  — caller may act on their own resource (lowest tier)
//   team — caller may act on resources of their team (mentor → learners)
//   org  — caller may act on anything inside their org (admin/hr)
//
// A holder of `org` scope passes a `team` or `own` requirement.
// A holder of `team` scope passes an `own` requirement.
// This middleware enforces ONLY the permission+scope tier check —
// the **target check** ("is this resource actually mine / in my team /
// in my org?") MUST be done in the route handler against `req.user`.
// We provide `scopeAllows(req, targetUserId)` helpers below for that.
//
// Why split? Because target identity is route-specific. The middleware
// can guarantee the caller is *capable* of the action at the required
// tier; only the handler knows which UUID it's operating on.

import { db } from '../db/index.js';
import { mentorBindings } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';

const TIER = { own: 0, team: 1, org: 2 };

export function requirePermission(code, requiredScope = 'org') {
  const need = TIER[requiredScope];
  if (need === undefined) {
    throw new Error(`requirePermission: unknown scope "${requiredScope}"`);
  }
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'unauthenticated' });

    const scopes = user.permissions?.[code];
    if (!scopes || scopes.size === 0) {
      return res.status(403).json({ error: 'forbidden', code, requiredScope });
    }
    // Pick the highest scope tier the caller holds for this code.
    let best = -1;
    for (const s of scopes) best = Math.max(best, TIER[s] ?? -1);
    if (best < need) {
      return res.status(403).json({
        error: 'forbidden_scope',
        code,
        requiredScope,
        haveScopes: [...scopes],
      });
    }
    next();
  };
}

// ----- target-level scope helpers -----
//
// These are called from inside handlers to verify that the specific
// target UUID is within the caller's allowed scope for that permission.

export function isOwn(req, targetUserId) {
  return req.user?.id === targetUserId;
}

export function isSameOrg(req, targetOrgId) {
  return !!targetOrgId && req.user?.orgId === targetOrgId;
}

/**
 * For permissions with scope=team: is `targetUserId` a learner bound
 * to the calling mentor?
 */
export async function isInMentorTeam(req, targetUserId) {
  if (!req.user) return false;
  const [row] = await db
    .select({ id: mentorBindings.id })
    .from(mentorBindings)
    .where(
      and(
        eq(mentorBindings.mentorId, req.user.id),
        eq(mentorBindings.learnerId, targetUserId),
        eq(mentorBindings.active, true),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * High-level convenience: given the permission `code`, the target's
 * `targetUserId` + `targetOrgId`, decide if the caller is allowed.
 * Honors the highest scope tier the caller holds.
 */
export async function canActOnUser(req, code, { targetUserId, targetOrgId }) {
  const scopes = req.user?.permissions?.[code];
  if (!scopes || scopes.size === 0) return false;
  // org tier — same org is enough
  if (scopes.has('org') && isSameOrg(req, targetOrgId)) return true;
  // team tier — mentor binding
  if (scopes.has('team') && (await isInMentorTeam(req, targetUserId))) return true;
  // own tier — self
  if (scopes.has('own') && isOwn(req, targetUserId)) return true;
  return false;
}
