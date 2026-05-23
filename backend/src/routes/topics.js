// /topics — curated learning topics tied to KB documents (Phase 3).
//
//   GET    /topics                       list (kb.view — anyone with read)
//   GET    /topics/published             list published-only (session.run, learners)
//   POST   /topics                       create (topic.manage)
//   PATCH  /topics/:id                   edit (topic.manage)
//   DELETE /topics/:id                   delete (topic.manage)
//   POST   /topics/:id/documents         attach doc (topic.manage)
//   DELETE /topics/:id/documents/:docId  detach doc (topic.manage)
//   POST   /topics/suggest               AI-suggest topics from a document (topic.manage)

import { Router } from 'express';
import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { topics, topicDocuments, documents } from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission } from '../rbac/requirePermission.js';
import { writeAudit } from '../auth/audit.js';
import { getLLM } from '../providers/index.js';

export const topicsRouter = Router();

topicsRouter.use(requireAuth);

// ---------- list (all) ----------
topicsRouter.get('/', requirePermission('kb.view', 'org'), async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(topics)
      .where(eq(topics.orgId, req.user.orgId))
      .orderBy(desc(topics.createdAt));
    res.json({ topics: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- list (published-only, for learners) ----------
//
// Any user who can run a session may browse the published catalog.
topicsRouter.get('/published', async (req, res) => {
  try {
    // No requirePermission — every authenticated user in org sees the
    // catalog. Server-side filter is org_id + status='published'.
    const rows = await db
      .select({
        id: topics.id,
        name: topics.name,
        description: topics.description,
        locale: topics.locale,
      })
      .from(topics)
      .where(and(eq(topics.orgId, req.user.orgId), eq(topics.status, 'published')))
      .orderBy(topics.name);
    res.json({ topics: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- single (with attached docs) ----------
topicsRouter.get('/:id', requirePermission('kb.view', 'org'), async (req, res) => {
  try {
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, req.params.id), eq(topics.orgId, req.user.orgId)))
      .limit(1);
    if (!topic) return res.status(404).json({ error: 'not found' });
    const docs = await db
      .select({
        id: documents.id,
        name: documents.name,
        status: documents.status,
        mime: documents.mime,
      })
      .from(topicDocuments)
      .innerJoin(documents, eq(documents.id, topicDocuments.documentId))
      .where(eq(topicDocuments.topicId, topic.id));
    res.json({ topic, documents: docs });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- create ----------
topicsRouter.post('/', requirePermission('topic.manage', 'org'), async (req, res) => {
  try {
    const { name, description = '', locale = 'ru', status = 'draft', documentIds = [] } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });

    const [topic] = await db
      .insert(topics)
      .values({
        orgId: req.user.orgId,
        name: name.trim().slice(0, 200),
        description: String(description).slice(0, 2000),
        locale: locale === 'en' || locale === 'uz' ? locale : 'ru',
        status: status === 'published' || status === 'archived' ? status : 'draft',
        createdBy: req.user.id,
      })
      .returning();

    if (Array.isArray(documentIds) && documentIds.length) {
      // Confirm each doc belongs to caller's org before linking.
      for (const docId of documentIds) {
        const [d] = await db
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.id, docId), eq(documents.orgId, req.user.orgId)))
          .limit(1);
        if (d) {
          await db
            .insert(topicDocuments)
            .values({ topicId: topic.id, documentId: d.id })
            .onConflictDoNothing();
        }
      }
    }

    await writeAudit({
      orgId: req.user.orgId,
      actorUserId: req.user.id,
      action: 'topic.create',
      targetType: 'topic',
      targetId: topic.id,
      meta: { name: topic.name, status: topic.status, documentIds },
    });

    res.json({ topic });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- edit ----------
topicsRouter.patch('/:id', requirePermission('topic.manage', 'org'), async (req, res) => {
  try {
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, req.params.id), eq(topics.orgId, req.user.orgId)))
      .limit(1);
    if (!topic) return res.status(404).json({ error: 'not found' });

    const patch = {};
    if (typeof req.body?.name === 'string') patch.name = req.body.name.trim().slice(0, 200);
    if (typeof req.body?.description === 'string') patch.description = req.body.description.slice(0, 2000);
    if (['ru', 'en', 'uz'].includes(req.body?.locale)) patch.locale = req.body.locale;
    if (['draft', 'published', 'archived'].includes(req.body?.status)) patch.status = req.body.status;
    if (Object.keys(patch).length === 0) return res.json({ topic });

    patch.updatedAt = new Date();
    const [updated] = await db.update(topics).set(patch).where(eq(topics.id, topic.id)).returning();

    await writeAudit({
      orgId: req.user.orgId,
      actorUserId: req.user.id,
      action: 'topic.update',
      targetType: 'topic',
      targetId: topic.id,
      meta: { patch },
    });

    res.json({ topic: updated });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- delete ----------
topicsRouter.delete('/:id', requirePermission('topic.manage', 'org'), async (req, res) => {
  try {
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, req.params.id), eq(topics.orgId, req.user.orgId)))
      .limit(1);
    if (!topic) return res.status(404).json({ error: 'not found' });
    await db.delete(topics).where(eq(topics.id, topic.id));
    await writeAudit({
      orgId: req.user.orgId,
      actorUserId: req.user.id,
      action: 'topic.delete',
      targetType: 'topic',
      targetId: topic.id,
      meta: { name: topic.name },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- attach / detach doc ----------
topicsRouter.post(
  '/:id/documents',
  requirePermission('topic.manage', 'org'),
  async (req, res) => {
    try {
      const { documentId } = req.body || {};
      if (!documentId) return res.status(400).json({ error: 'documentId required' });
      const [t] = await db
        .select({ id: topics.id })
        .from(topics)
        .where(and(eq(topics.id, req.params.id), eq(topics.orgId, req.user.orgId)))
        .limit(1);
      if (!t) return res.status(404).json({ error: 'topic not found' });
      const [d] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.orgId, req.user.orgId)))
        .limit(1);
      if (!d) return res.status(404).json({ error: 'document not found' });
      await db
        .insert(topicDocuments)
        .values({ topicId: t.id, documentId: d.id })
        .onConflictDoNothing();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

topicsRouter.delete(
  '/:id/documents/:docId',
  requirePermission('topic.manage', 'org'),
  async (req, res) => {
    try {
      await db
        .delete(topicDocuments)
        .where(
          and(
            eq(topicDocuments.topicId, req.params.id),
            eq(topicDocuments.documentId, req.params.docId),
          ),
        );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- AI suggest ----------
//
// Given a documentId, ask the LLM to propose 5–8 topic candidates with
// a one-line description each. Caller picks which to materialize.
topicsRouter.post(
  '/suggest',
  requirePermission('topic.manage', 'org'),
  async (req, res) => {
    try {
      const { documentId, locale = 'ru' } = req.body || {};
      if (!documentId) return res.status(400).json({ error: 'documentId required' });
      const [doc] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.orgId, req.user.orgId)))
        .limit(1);
      if (!doc) return res.status(404).json({ error: 'document not found' });
      if (!doc.plainText) {
        return res.status(409).json({ error: 'document not yet indexed' });
      }
      const lang = ['ru', 'en', 'uz'].includes(locale) ? locale : 'ru';
      const HINT = {
        ru: 'Все строки на русском.',
        en: 'All strings in English.',
        uz: "Barcha satrlar o'zbek tilida.",
      };
      const system = `You propose learning topics. Output ONLY a JSON object:
{"topics":[{"name":"...","description":"...","competencies":["...","..."]}]}
5–8 topics. Each name ≤ 60 chars, description ≤ 200 chars. Each topic 3–6 competencies (name only). ${HINT[lang]} No prose outside JSON.`;
      const userPrompt = `Document: "${doc.name}"\n\nExcerpt:\n${doc.plainText.slice(0, 3500)}`;

      const { text } = await getLLM().complete({
        system,
        messages: [{ role: 'user', content: userPrompt }],
        tier: 'assessor',
        maxTokens: 1200,
      });

      // Defensive parse — same routine as the assessor parser
      let parsed;
      try {
        let t = text.trim();
        const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) t = fence[1].trim();
        const start = t.indexOf('{');
        const end = t.lastIndexOf('}');
        parsed = JSON.parse(t.slice(start, end + 1));
      } catch (err) {
        return res.status(502).json({ error: 'LLM returned invalid JSON', raw: text });
      }
      const suggestions = (parsed.topics || []).slice(0, 8).map((t) => ({
        name: String(t.name || '').slice(0, 60),
        description: String(t.description || '').slice(0, 200),
        competencies: Array.isArray(t.competencies)
          ? t.competencies.slice(0, 6).map((c) => String(c).slice(0, 60))
          : [],
      }));
      res.json({ suggestions });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);
