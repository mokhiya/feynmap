// /assignments — push lessons/topics to specific learners (Phase 4).
//
//   GET    /assignments              list (own / team / org per perms)
//   POST   /assignments              create (assignment.create)
//   POST   /assignments/:id/complete mark complete (assignee)
//   DELETE /assignments/:id          cancel (creator)

import { Router } from 'express';
import { and, eq, desc, inArray, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import { assignments, topics, lessons } from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission } from '../rbac/requirePermission.js';
import { writeAudit } from '../auth/audit.js';

export const assignmentsRouter = Router();

assignmentsRouter.use(requireAuth);

// ---------- list ----------
assignmentsRouter.get('/', async (req, res) => {
  try {
    const orgScope = req.user.permissions.get('assignment.view')?.has('org');
    const teamScope = req.user.permissions.get('assignment.view')?.has('team');
    const ownScope = req.user.permissions.get('assignment.view')?.has('own');
    if (!orgScope && !teamScope && !ownScope) return res.status(403).json({ error: 'forbidden' });

    let where = and(eq(assignments.orgId, req.user.orgId), eq(assignments.assigneeId, req.user.id));
    if (orgScope) where = eq(assignments.orgId, req.user.orgId);
    else if (teamScope) {
      // own + mentee assignments
      const mentees = await db.execute(raw`
        SELECT learner_id FROM mentor_bindings
        WHERE mentor_id = ${req.user.id} AND active = true
      `);
      const ids = [req.user.id, ...mentees.map((r) => r.learner_id)];
      where = and(eq(assignments.orgId, req.user.orgId), inArray(assignments.assigneeId, ids));
    }

    const rows = await db
      .select()
      .from(assignments)
      .where(where)
      .orderBy(desc(assignments.createdAt))
      .limit(500);
    res.json({ assignments: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- create ----------
assignmentsRouter.post(
  '/',
  requirePermission('assignment.create', 'team'),
  async (req, res) => {
    try {
      const { assigneeIds, targetType, targetId, dueAt } = req.body || {};
      if (!Array.isArray(assigneeIds) || assigneeIds.length === 0)
        return res.status(400).json({ error: 'assigneeIds[] required' });
      if (targetType !== 'topic' && targetType !== 'lesson')
        return res.status(400).json({ error: 'targetType must be topic|lesson' });
      if (!targetId) return res.status(400).json({ error: 'targetId required' });

      // Verify target belongs to org
      const table = targetType === 'topic' ? topics : lessons;
      const [t] = await db
        .select()
        .from(table)
        .where(and(eq(table.id, targetId), eq(table.orgId, req.user.orgId)))
        .limit(1);
      if (!t) return res.status(404).json({ error: `${targetType} not found` });

      const created = [];
      for (const id of assigneeIds) {
        const [a] = await db
          .insert(assignments)
          .values({
            orgId: req.user.orgId,
            assignerId: req.user.id,
            assigneeId: id,
            targetType,
            targetId,
            dueAt: dueAt ? new Date(dueAt) : null,
            status: 'assigned',
          })
          .returning();
        created.push(a);
        await writeAudit({
          orgId: req.user.orgId,
          actorUserId: req.user.id,
          action: 'assignment.create',
          targetType: 'assignment',
          targetId: a.id,
          meta: { assigneeId: id, targetType, targetRefId: targetId, dueAt },
        });
      }

      res.json({ assignments: created });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- complete ----------
assignmentsRouter.post('/:id/complete', async (req, res) => {
  try {
    const [a] = await db.select().from(assignments).where(eq(assignments.id, req.params.id)).limit(1);
    if (!a || a.orgId !== req.user.orgId) return res.status(404).json({ error: 'not found' });
    if (a.assigneeId !== req.user.id) return res.status(403).json({ error: 'not your assignment' });
    const [updated] = await db
      .update(assignments)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(assignments.id, a.id))
      .returning();
    await writeAudit({
      orgId: a.orgId,
      actorUserId: req.user.id,
      action: 'assignment.complete',
      targetType: 'assignment',
      targetId: a.id,
      meta: {},
    });
    res.json({ assignment: updated });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

assignmentsRouter.delete('/:id', async (req, res) => {
  try {
    const [a] = await db.select().from(assignments).where(eq(assignments.id, req.params.id)).limit(1);
    if (!a || a.orgId !== req.user.orgId) return res.status(404).json({ error: 'not found' });
    if (a.assignerId !== req.user.id)
      return res.status(403).json({ error: 'only the creator may cancel' });
    await db
      .update(assignments)
      .set({ status: 'cancelled' })
      .where(eq(assignments.id, a.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
