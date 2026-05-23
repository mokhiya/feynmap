// /reviews — spaced repetition (M3.3).
//
//   GET    /reviews/due         list reviews due now (own)
//   POST   /reviews/:id/done    mark complete + schedule next (SM-2 light)
//   POST   /reviews             create from a competency gap (called by sessions.finalize)

import { Router } from 'express';
import { and, eq, lte, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import { spacedReviews } from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';

export const reviewsRouter = Router();
reviewsRouter.use(requireAuth);

// SM-2 lite scheduling
function nextInterval(prev, easeFactor, score /* 0..100 */) {
  const quality = Math.max(0, Math.min(5, Math.round(score / 20))); // 0..5
  let ef = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ef < 1.3) ef = 1.3;
  if (quality < 3) return { intervalDays: 1, easeFactor: ef };
  if (prev <= 0) return { intervalDays: 1, easeFactor: ef };
  if (prev === 1) return { intervalDays: 6, easeFactor: ef };
  return { intervalDays: Math.round(prev * ef), easeFactor: ef };
}

reviewsRouter.get('/due', async (req, res) => {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(spacedReviews)
      .where(
        and(
          eq(spacedReviews.orgId, req.user.orgId),
          eq(spacedReviews.userId, req.user.id),
          lte(spacedReviews.reviewAt, now),
        ),
      )
      .orderBy(spacedReviews.reviewAt);
    res.json({ reviews: rows.filter((r) => !r.completedAt) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

reviewsRouter.post('/:id/done', async (req, res) => {
  try {
    const { score = 0 } = req.body || {};
    const [r] = await db
      .select()
      .from(spacedReviews)
      .where(eq(spacedReviews.id, req.params.id))
      .limit(1);
    if (!r || r.orgId !== req.user.orgId || r.userId !== req.user.id)
      return res.status(404).json({ error: 'not found' });
    const { intervalDays, easeFactor } = nextInterval(r.intervalDays, r.easeFactor, score);
    const nextAt = new Date(Date.now() + intervalDays * 86400_000);
    const [next] = await db
      .insert(spacedReviews)
      .values({
        orgId: r.orgId,
        userId: r.userId,
        topicId: r.topicId,
        competencyName: r.competencyName,
        lastScore: score,
        reviewAt: nextAt,
        intervalDays,
        easeFactor,
      })
      .returning();
    await db
      .update(spacedReviews)
      .set({ completedAt: new Date() })
      .where(eq(spacedReviews.id, r.id));
    res.json({ next });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

reviewsRouter.post('/', async (req, res) => {
  try {
    const { topicId, competencyName, lastScore = 0 } = req.body || {};
    if (!competencyName) return res.status(400).json({ error: 'competencyName required' });
    const [row] = await db
      .insert(spacedReviews)
      .values({
        orgId: req.user.orgId,
        userId: req.user.id,
        topicId: topicId || null,
        competencyName: String(competencyName).slice(0, 60),
        lastScore: Math.max(0, Math.min(100, Number(lastScore) || 0)),
        reviewAt: new Date(Date.now() + 86400_000),
        intervalDays: 1,
        easeFactor: 2.5,
      })
      .returning();
    res.json({ review: row });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
