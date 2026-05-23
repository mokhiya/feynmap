// /role-targets — competency target levels per organizational role label (M3.2).
//
// Usage: Assessor (or admin) defines "for the Backend dev role, the target
// for the competency 'TCP protocol purpose' is 80". The learner's report
// can then overlay actual-vs-target as a delta on the radar.
//
//   GET    /role-targets                  list all (org-scoped)
//   GET    /role-targets/:roleLabel       list targets for a single role
//   POST   /role-targets                  create one
//   PUT    /role-targets/:id              update target score
//   DELETE /role-targets/:id              remove one
//   GET    /role-targets/_gap/:userId     gap-to-target for a given learner
//                                         (compares last finalized result vs
//                                          user.fullName-derived role — for v1
//                                          we accept ?roleLabel=<...> query)

import { Router } from 'express';
import { and, eq, desc, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  roleTargets,
  assessmentResults,
  sessions,
} from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission, isSameOrg, isOwn } from '../rbac/requirePermission.js';
import { writeAudit } from '../auth/audit.js';

export const roleTargetsRouter = Router();
roleTargetsRouter.use(requireAuth);

// ---------- list (any org member can see the published target levels) ----------
roleTargetsRouter.get('/', async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(roleTargets)
      .where(eq(roleTargets.orgId, req.user.orgId))
      .orderBy(roleTargets.roleLabel, roleTargets.competencyName);
    res.json({ targets: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

roleTargetsRouter.get('/by-role/:roleLabel', async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(roleTargets)
      .where(
        and(
          eq(roleTargets.orgId, req.user.orgId),
          eq(roleTargets.roleLabel, req.params.roleLabel),
        ),
      )
      .orderBy(roleTargets.competencyName);
    res.json({ targets: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- gap-to-target ----------
// For a user + roleLabel, returns latest finalized assessment competencies
// joined against the role's target_score so the UI can draw an overlay.
roleTargetsRouter.get('/_gap/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const roleLabel = String(req.query.roleLabel || '').trim();
    if (!roleLabel) return res.status(400).json({ error: 'roleLabel required' });

    // own / team / org gating
    if (!isOwn(req, userId)) {
      const orgScope = req.user.permissions?.some(
        (p) => p.code === 'results.org' && p.scope === 'org',
      );
      const teamScope = req.user.permissions?.some(
        (p) => p.code === 'results.team' && p.scope === 'team',
      );
      if (!orgScope && !teamScope)
        return res.status(403).json({ error: 'forbidden' });
    }

    const targets = await db
      .select()
      .from(roleTargets)
      .where(
        and(
          eq(roleTargets.orgId, req.user.orgId),
          eq(roleTargets.roleLabel, roleLabel),
        ),
      );

    // Find latest finalized result for the user.
    const [latest] = await db
      .select({
        id: assessmentResults.id,
        competencies: assessmentResults.competencies,
        status: assessmentResults.status,
        sessionId: assessmentResults.sessionId,
      })
      .from(assessmentResults)
      .innerJoin(sessions, eq(assessmentResults.sessionId, sessions.id))
      .where(
        and(
          eq(assessmentResults.orgId, req.user.orgId),
          eq(assessmentResults.userId, userId),
        ),
      )
      .orderBy(desc(sessions.finalizedAt))
      .limit(1);

    const comps = latest?.competencies || [];
    const compByName = new Map(
      comps.map((c) => [String(c.name || '').toLowerCase(), c]),
    );

    const overlay = targets.map((t) => {
      const c = compByName.get(t.competencyName.toLowerCase());
      const actual = c ? Math.max(0, Math.min(100, Number(c.score) || 0)) : null;
      return {
        competencyName: t.competencyName,
        target: t.targetScore,
        actual,
        gap: actual == null ? t.targetScore : Math.max(0, t.targetScore - actual),
      };
    });

    res.json({
      roleLabel,
      userId,
      resultId: latest?.id || null,
      overlay,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- create / update / delete (topic.manage, org) ----------
roleTargetsRouter.post(
  '/',
  requirePermission('topic.manage', 'org'),
  async (req, res) => {
    try {
      const { roleLabel, competencyName, targetScore = 70, competencyId } =
        req.body || {};
      if (!roleLabel || !competencyName)
        return res
          .status(400)
          .json({ error: 'roleLabel and competencyName required' });
      const score = Math.max(0, Math.min(100, Number(targetScore) || 0));
      const [row] = await db
        .insert(roleTargets)
        .values({
          orgId: req.user.orgId,
          roleLabel: String(roleLabel).slice(0, 80),
          competencyName: String(competencyName).slice(0, 80),
          competencyId: competencyId || null,
          targetScore: score,
        })
        .returning();
      await writeAudit({
        orgId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'role_target.create',
        targetType: 'role_target',
        targetId: row.id,
        meta: { roleLabel: row.roleLabel, competencyName: row.competencyName, targetScore: row.targetScore },
      });
      res.json({ target: row });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

roleTargetsRouter.put(
  '/:id',
  requirePermission('topic.manage', 'org'),
  async (req, res) => {
    try {
      const [existing] = await db
        .select()
        .from(roleTargets)
        .where(eq(roleTargets.id, req.params.id))
        .limit(1);
      if (!existing || !isSameOrg(req, existing.orgId))
        return res.status(404).json({ error: 'not found' });
      const score = Math.max(
        0,
        Math.min(100, Number(req.body?.targetScore) || 0),
      );
      const [updated] = await db
        .update(roleTargets)
        .set({ targetScore: score })
        .where(eq(roleTargets.id, existing.id))
        .returning();
      await writeAudit({
        orgId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'role_target.update',
        targetType: 'role_target',
        targetId: existing.id,
        meta: { before: existing.targetScore, after: updated.targetScore },
      });
      res.json({ target: updated });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

roleTargetsRouter.delete(
  '/:id',
  requirePermission('topic.manage', 'org'),
  async (req, res) => {
    try {
      const [existing] = await db
        .select()
        .from(roleTargets)
        .where(eq(roleTargets.id, req.params.id))
        .limit(1);
      if (!existing || !isSameOrg(req, existing.orgId))
        return res.status(404).json({ error: 'not found' });
      await db.delete(roleTargets).where(eq(roleTargets.id, existing.id));
      await writeAudit({
        orgId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'role_target.delete',
        targetType: 'role_target',
        targetId: existing.id,
        meta: { roleLabel: existing.roleLabel, competencyName: existing.competencyName },
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);
