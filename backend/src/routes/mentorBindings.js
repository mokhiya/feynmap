// Mentor ↔ learner bindings.
//
//   GET    /mentor-bindings                  list (org-scoped)
//   POST   /mentor-bindings                  create { mentorId, learnerId }
//   DELETE /mentor-bindings/:id              soft-deactivate (active=false)
//
// Gated by user.manage (org): admins/HR can wire up the team graph.
// We deliberately do NOT let mentors bind themselves — that's an
// audit-trail trap.

import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mentorBindings, users, userRoles, roles } from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission } from '../rbac/requirePermission.js';
import { audit } from '../auth/audit.js';

export const mentorBindingsRouter = Router();
mentorBindingsRouter.use(requireAuth);

mentorBindingsRouter.get(
  '/',
  requirePermission('user.manage', 'org'),
  async (req, res) => {
    const rows = await db
      .select({
        id: mentorBindings.id,
        mentorId: mentorBindings.mentorId,
        learnerId: mentorBindings.learnerId,
        active: mentorBindings.active,
        createdAt: mentorBindings.createdAt,
      })
      .from(mentorBindings)
      .where(eq(mentorBindings.orgId, req.user.orgId));
    res.json({ bindings: rows });
  },
);

mentorBindingsRouter.post(
  '/',
  requirePermission('user.manage', 'org'),
  async (req, res) => {
    const { mentorId, learnerId } = req.body || {};
    if (!mentorId || !learnerId) {
      return res.status(400).json({ error: 'mentorId and learnerId required' });
    }
    if (mentorId === learnerId) {
      return res.status(400).json({ error: 'mentor and learner must differ' });
    }

    // Both users must be in caller's org.
    const both = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.orgId, req.user.orgId));
    const orgIds = new Set(both.map((u) => u.id));
    if (!orgIds.has(mentorId) || !orgIds.has(learnerId)) {
      return res.status(404).json({ error: 'mentor or learner not in your org' });
    }

    // Sanity: mentor should actually hold the `mentor` role.
    const mentorHasRole = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, mentorId), eq(roles.code, 'mentor')))
      .limit(1);
    if (!mentorHasRole.length) {
      return res.status(400).json({ error: 'target user is not a mentor' });
    }

    try {
      const [row] = await db
        .insert(mentorBindings)
        .values({ orgId: req.user.orgId, mentorId, learnerId, active: true })
        .onConflictDoUpdate({
          target: [mentorBindings.mentorId, mentorBindings.learnerId],
          set: { active: true },
        })
        .returning();
      await audit({
        req, orgId: req.user.orgId, actorUserId: req.user.id,
        action: 'mentor.bind', targetType: 'user', targetId: learnerId,
        meta: { mentorId, bindingId: row.id },
      });
      res.status(201).json({ binding: row });
    } catch (e) {
      console.error('[POST /mentor-bindings]', e);
      res.status(500).json({ error: 'create failed' });
    }
  },
);

mentorBindingsRouter.delete(
  '/:id',
  requirePermission('user.manage', 'org'),
  async (req, res) => {
    const result = await db
      .update(mentorBindings)
      .set({ active: false })
      .where(
        and(
          eq(mentorBindings.orgId, req.user.orgId),
          eq(mentorBindings.id, req.params.id),
        ),
      )
      .returning({ id: mentorBindings.id, learnerId: mentorBindings.learnerId, mentorId: mentorBindings.mentorId });
    if (!result.length) return res.status(404).json({ error: 'not found' });
    await audit({
      req, orgId: req.user.orgId, actorUserId: req.user.id,
      action: 'mentor.unbind', targetType: 'user', targetId: result[0].learnerId,
      meta: { mentorId: result[0].mentorId, bindingId: result[0].id },
    });
    res.json({ ok: true });
  },
);
