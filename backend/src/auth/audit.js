// Thin helper for inserting AuditLog rows. Centralized so we never
// scatter free-form `db.insert(auditLogs)` calls across routes.
//
// Usage:
//   await audit({
//     req, orgId, actorUserId,
//     action: 'auth.login',
//     targetType: 'user', targetId: user.id,
//     meta: { ... },
//   });

import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export async function audit({
  req,
  orgId,
  actorUserId = null,
  action,
  targetType = null,
  targetId = null,
  meta = {},
}) {
  try {
    await db.insert(auditLogs).values({
      orgId,
      actorUserId,
      action,
      targetType,
      targetId,
      meta,
      ipAddress: req?.ip || null,
      userAgent: (req?.headers?.['user-agent'] || '').slice(0, 500) || null,
    });
  } catch (e) {
    // Audit failures must NEVER break the request. Log + swallow.
    console.error('[audit] insert failed:', e?.message || e, { action });
  }
}

// Phase 2+ routes pass ipAddress / userAgent directly (no req object).
// Keeps the signature flat for callsites in documents/topics/sessions/...
export async function writeAudit({
  orgId,
  actorUserId = null,
  action,
  targetType = null,
  targetId = null,
  meta = {},
  ipAddress = null,
  userAgent = null,
}) {
  try {
    await db.insert(auditLogs).values({
      orgId,
      actorUserId,
      action,
      targetType,
      targetId,
      meta,
      ipAddress,
      userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
    });
  } catch (e) {
    console.error('[audit] insert failed:', e?.message || e, { action });
  }
}
