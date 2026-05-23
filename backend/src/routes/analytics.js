// /analytics — aggregated readouts (Phase 6 + M3.2 + M5 cohort).
//
//   GET /analytics/me                 own progress
//   GET /analytics/learner/:id        single learner (results.team|org)
//   GET /analytics/team               team radar (results.team)
//   GET /analytics/org                org radar + heatmap (results.org)
//   GET /analytics/role-targets       all targets for caller's org
//   POST/PUT /analytics/role-targets  upsert (assessment.override or topic.manage)
//
// Hidden-from-HR rule (M2.5.1): aggregations only count sessions where
// mode = 'assessment'. Practice sessions are private by default.

import { Router } from 'express';
import { and, eq, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, assessmentResults, roleTargets } from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission } from '../rbac/requirePermission.js';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

// ---------- me ----------
analyticsRouter.get('/me', async (req, res) => {
  try {
    const rows = await db
      .select({
        sessionId: sessions.id,
        topic: sessions.topicLabel,
        mode: sessions.mode,
        status: sessions.status,
        finalizedAt: sessions.finalizedAt,
        competencies: assessmentResults.competencies,
        nextFocus: assessmentResults.nextFocus,
        resultStatus: assessmentResults.status,
      })
      .from(sessions)
      .leftJoin(assessmentResults, eq(assessmentResults.sessionId, sessions.id))
      .where(and(eq(sessions.orgId, req.user.orgId), eq(sessions.userId, req.user.id)));
    res.json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- learner ----------
analyticsRouter.get('/learner/:id', async (req, res) => {
  try {
    // Permission check: results.org OR results.team
    const orgScope = req.user.permissions.get('results.org')?.has('org');
    const teamScope = req.user.permissions.get('results.team')?.has('team');
    if (!orgScope && !teamScope) return res.status(403).json({ error: 'forbidden' });

    // If only team-scope, verify mentor binding.
    if (!orgScope && teamScope) {
      const m = await db.execute(raw`
        SELECT 1 FROM mentor_bindings
        WHERE mentor_id = ${req.user.id}
          AND learner_id = ${req.params.id}
          AND active = true
        LIMIT 1
      `);
      if (m.length === 0) return res.status(403).json({ error: 'not your mentee' });
    }

    const rows = await db
      .select({
        sessionId: sessions.id,
        topic: sessions.topicLabel,
        finalizedAt: sessions.finalizedAt,
        competencies: assessmentResults.competencies,
        overallStrengths: assessmentResults.strengths,
        gaps: assessmentResults.gaps,
        resultStatus: assessmentResults.status,
      })
      .from(sessions)
      .innerJoin(assessmentResults, eq(assessmentResults.sessionId, sessions.id))
      .where(
        and(
          eq(sessions.orgId, req.user.orgId),
          eq(sessions.userId, req.params.id),
          eq(sessions.mode, 'assessment'),
        ),
      );
    res.json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- team radar ----------
analyticsRouter.get(
  '/team',
  requirePermission('results.team', 'team'),
  async (req, res) => {
    try {
      const rows = await db.execute(raw`
        SELECT c.name AS name, AVG((c.score)::float) AS score, COUNT(*) AS n
        FROM sessions s
        JOIN assessment_results ar ON ar.session_id = s.id
        JOIN mentor_bindings mb ON mb.learner_id = s.user_id AND mb.active = true
        JOIN LATERAL jsonb_to_recordset(ar.competencies)
          AS c(name text, score int) ON true
        WHERE mb.mentor_id = ${req.user.id}
          AND s.org_id = ${req.user.orgId}
          AND s.mode = 'assessment'
          AND ar.status IN ('auto','approved','overridden')
        GROUP BY c.name
        ORDER BY score ASC
      `);
      res.json({ competencies: rows });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- org radar + heatmap ----------
analyticsRouter.get(
  '/org',
  requirePermission('results.org', 'org'),
  async (req, res) => {
    try {
      const radar = await db.execute(raw`
        SELECT c.name AS name, AVG((c.score)::float) AS score, COUNT(*) AS n
        FROM sessions s
        JOIN assessment_results ar ON ar.session_id = s.id
        JOIN LATERAL jsonb_to_recordset(ar.competencies)
          AS c(name text, score int) ON true
        WHERE s.org_id = ${req.user.orgId}
          AND s.mode = 'assessment'
          AND ar.status IN ('auto','approved','overridden')
        GROUP BY c.name
        ORDER BY score ASC
      `);

      // Cohort heatmap by topic
      const heatmap = await db.execute(raw`
        SELECT s.topic_label AS topic, c.name AS competency,
               AVG((c.score)::float) AS score, COUNT(*) AS n
        FROM sessions s
        JOIN assessment_results ar ON ar.session_id = s.id
        JOIN LATERAL jsonb_to_recordset(ar.competencies)
          AS c(name text, score int) ON true
        WHERE s.org_id = ${req.user.orgId}
          AND s.mode = 'assessment'
          AND ar.status IN ('auto','approved','overridden')
        GROUP BY s.topic_label, c.name
        ORDER BY s.topic_label, c.name
      `);
      res.json({ radar, heatmap });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- role targets (M3.2) ----------
analyticsRouter.get('/role-targets', async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(roleTargets)
      .where(eq(roleTargets.orgId, req.user.orgId));
    res.json({ targets: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

analyticsRouter.post(
  '/role-targets',
  requirePermission('competency.manage', 'org'),
  async (req, res) => {
    try {
      const { roleLabel, competencyName, targetScore = 70 } = req.body || {};
      if (!roleLabel || !competencyName)
        return res.status(400).json({ error: 'roleLabel + competencyName required' });
      const [row] = await db
        .insert(roleTargets)
        .values({
          orgId: req.user.orgId,
          roleLabel: String(roleLabel).slice(0, 100),
          competencyName: String(competencyName).slice(0, 100),
          targetScore: Math.max(0, Math.min(100, Number(targetScore) || 70)),
        })
        .returning();
      res.json({ target: row });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);
