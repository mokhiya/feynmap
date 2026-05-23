// /sessions — DB-persisted, RAG-grounded learning sessions (Phase 5).
//
//   POST   /sessions                       start a new session
//   GET    /sessions                       list own sessions (or org if results.org)
//   GET    /sessions/:id                   single (own/team/org per perms)
//   POST   /sessions/:id/turn              expert utterance → student question + assessor update
//   POST   /sessions/:id/finalize          mark done + persist final assessment
//   POST   /sessions/:id/convert           practice → assessment (M2.5.1)
//   POST   /sessions/:id/override          Assessor override (M2.2)
//   POST   /sessions/:id/appeal            learner appeal (M2.2)
//   POST   /sessions/:id/appeal/:appealId/resolve  Assessor resolves appeal
//
// Anti-fraud (M2.3): turn endpoint accepts pasteSize, typingMs, deletes —
// flags computed server-side and stored in sessions.flags.
//
// Wellbeing (M2.5.3-4): client may send signals.{frustrated} and we adapt
// the next-question prompt accordingly; recorded in sessions.wellbeing.

import { Router } from 'express';
import { and, eq, desc, sql as raw } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  sessions,
  assessmentResults,
  assessmentAppeals,
  topics,
  documents,
  topicDocuments,
  spacedReviews,
} from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission, isOwn, isSameOrg } from '../rbac/requirePermission.js';
import { writeAudit } from '../auth/audit.js';
import { getLLM } from '../providers/index.js';
import { retrieveChunks, formatReferenceBlock } from '../rag/retrieve.js';

export const sessionsRouter = Router();

sessionsRouter.use(requireAuth);

// ---------- prompt scaffolding ----------

const STUDENT_BASE = `You are a naive, curious student. You do NOT know the topic being explained to you.
Your job: learn by asking short, concrete questions of the human expert.

Rules:
- Ask EXACTLY ONE short question per turn (1–2 sentences, no preamble).
- Latch onto unclear bits: if the expert uses an undefined term — ask what it means.
- Request concrete examples, everyday analogies, numeric illustrations.
- Never pretend to understand. No "got it", "thanks", "ok" filler — go straight to the question.
- Friendly, curious, but persistent.`;

const STUDENT_SUPPORTIVE_SUFFIX = `
Tone for THIS turn: extra warm. The expert appears stressed. Open with a brief affirmation
("ясно, что ты уже многое объяснил" / "I see you've covered a lot already"), then a gentle question.
Do NOT make it sound like a quiz. Make it sound like genuine curiosity.`;

const ASSESSOR_BASE = `You are an invisible assessor. From the dialogue between the expert (user) and the naive student (assistant), you score how confidently the expert masters the topic.

RESPOND ONLY WITH VALID JSON. No markdown fences, no preamble, no comments.

Schema:
{
  "competencies": [
    {
      "name": "short competency name",
      "score": 0,
      "criterion": "what mastery looks like in 1 phrase",
      "evidence": "what the expert showed/missed in 1 phrase",
      "gap": false,
      "source_refs": [0]
    }
  ],
  "next_focus": "name of one competency from the list — where to dig next",
  "overall": 0,
  "strengths": ["..."],
  "growth_zones": ["..."],
  "recommendations": ["concrete next step"]
}

Rules:
- On the FIRST turn produce 5–7 key competencies for this topic. On subsequent turns DO NOT change the set — only update score, evidence, gap, source_refs.
- score ∈ [0, 100]. 0 = not shown at all, 100 = mastery with examples and nuance.
- gap = true if score < 40 OR the competency was not addressed in the dialogue.
- source_refs[] = indices into the reference material block (0-based, as numbered [#1], [#2]…). Empty array if none used.
- next_focus = name of the competency with the lowest score (prefer gap=true).
- overall = weighted average across all competencies.
- "growth_zones" replaces the harsh "gaps" word — list 2–4 concrete topics to grow into.
- Competency names: short, up to 4 words.`;

const LANG = {
  ru: { student: 'Отвечай ИСКЛЮЧИТЕЛЬНО на русском языке.', assessor: 'Все строковые поля JSON — на русском.' },
  en: { student: 'Respond ONLY in English.', assessor: 'All JSON string fields — in English.' },
  uz: { student: "Faqat o'zbek tilida javob ber.", assessor: "JSONning barcha matn maydonlari — o'zbekcha." },
};

function normLang(l) {
  return l === 'ru' || l === 'en' || l === 'uz' ? l : 'ru';
}

function stripJson(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON not found in: ' + text.slice(0, 200));
  return t.slice(start, end + 1);
}

// ---------- start ----------
sessionsRouter.post('/', requirePermission('session.run', 'own'), async (req, res) => {
  try {
    const { topicId, topicLabel, mode, locale, assignmentId } = req.body || {};
    const L = normLang(locale);

    // Resolve topic. topicId is preferred (links to KB); topicLabel is
    // a legacy free-text fallback we still accept for backward compat
    // but UI should always pass topicId.
    let topic = null;
    let label = String(topicLabel || '').trim();
    if (topicId) {
      const [t] = await db
        .select()
        .from(topics)
        .where(and(eq(topics.id, topicId), eq(topics.orgId, req.user.orgId)))
        .limit(1);
      if (!t) return res.status(404).json({ error: 'topic not found' });
      topic = t;
      label = label || t.name;
    }
    if (!label) return res.status(400).json({ error: 'topicId or topicLabel required' });

    // Snapshot doc versions in scope so RAG retrieval against this
    // session is reproducible later even after reindex (M5).
    const docVersions = {};
    if (topic) {
      const rows = await db
        .select({ id: documents.id, version: documents.version })
        .from(topicDocuments)
        .innerJoin(documents, eq(documents.id, topicDocuments.documentId))
        .where(eq(topicDocuments.topicId, topic.id));
      for (const r of rows) docVersions[r.id] = r.version;
    }

    const [session] = await db
      .insert(sessions)
      .values({
        orgId: req.user.orgId,
        userId: req.user.id,
        topicId: topic?.id ?? null,
        topicLabel: label.slice(0, 200),
        mode: mode === 'assessment' ? 'assessment' : 'practice',
        status: 'in_progress',
        locale: L,
        transcript: [],
        docVersions,
        assignmentId: assignmentId || null,
      })
      .returning();

    await writeAudit({
      orgId: req.user.orgId,
      actorUserId: req.user.id,
      action: 'session.start',
      targetType: 'session',
      targetId: session.id,
      meta: { mode: session.mode, topicId: session.topicId, topicLabel: session.topicLabel },
    });

    // Generate the first student question with RAG context.
    const refQuery = `${label}`;
    const { chunks } = await retrieveChunks({
      orgId: req.user.orgId,
      topicId: topic?.id,
      query: refQuery,
      k: 4,
    });
    const refBlock = formatReferenceBlock(chunks, L);

    const KICK = {
      ru: `Тема, которую я буду тебе объяснять: "${label}". Задай первый наивный вопрос.`,
      en: `The topic I will explain to you: "${label}". Ask your first naive question.`,
      uz: `Men sizga tushuntiradigan mavzu: "${label}". Birinchi sodda savolingizni bering.`,
    };

    const systemText = [
      STUDENT_BASE,
      LANG[L].student,
      `Conversation topic: "${label}".`,
      refBlock,
    ]
      .filter(Boolean)
      .join('\n\n');

    const { text: firstQ } = await getLLM().complete({
      system: systemText,
      messages: [{ role: 'user', content: KICK[L] }],
      tier: 'student',
      maxTokens: 400,
      cache: { ephemeral: true },
    });

    const transcript = [{ role: 'assistant', content: firstQ }];
    const [updated] = await db
      .update(sessions)
      .set({ transcript, updatedAt: new Date() })
      .where(eq(sessions.id, session.id))
      .returning();

    res.json({ session: updated, firstQuestion: firstQ });
  } catch (e) {
    console.error('[sessions] start error', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- list ----------
sessionsRouter.get('/', async (req, res) => {
  try {
    const orgWide = req.user.permissions.get('results.org')?.has('org');
    const where = orgWide
      ? eq(sessions.orgId, req.user.orgId)
      : and(eq(sessions.orgId, req.user.orgId), eq(sessions.userId, req.user.id));
    const rows = await db
      .select({
        id: sessions.id,
        topicLabel: sessions.topicLabel,
        mode: sessions.mode,
        status: sessions.status,
        userId: sessions.userId,
        startedAt: sessions.startedAt,
        finalizedAt: sessions.finalizedAt,
      })
      .from(sessions)
      .where(where)
      .orderBy(desc(sessions.startedAt))
      .limit(200);
    res.json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Hidden-from-HR rule (M2.5.1): for results.org listing, exclude
// practice mode sessions unless caller explicitly opts in.
// (UI passes ?includePractice=1 only on a private dashboard view.)

// ---------- single ----------
sessionsRouter.get('/:id', async (req, res) => {
  try {
    const [s] = await db.select().from(sessions).where(eq(sessions.id, req.params.id)).limit(1);
    if (!s) return res.status(404).json({ error: 'not found' });
    if (!isSameOrg(req, s.orgId)) return res.status(404).json({ error: 'not found' });

    // Visibility:
    //  - own session → always
    //  - practice & not own → never (private by default, M2.5.1)
    //  - assessment & not own & has results.org/team → allowed
    if (!isOwn(req, s.userId)) {
      if (s.mode === 'practice') return res.status(403).json({ error: 'private session' });
      const canOrg = req.user.permissions.get('results.org')?.has('org');
      const canTeam = req.user.permissions.get('results.team')?.has('team');
      if (!canOrg && !canTeam) return res.status(403).json({ error: 'forbidden' });
    }

    const [result] = await db
      .select()
      .from(assessmentResults)
      .where(eq(assessmentResults.sessionId, s.id))
      .limit(1);
    res.json({ session: s, result: result || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- turn ----------
sessionsRouter.post('/:id/turn', requirePermission('session.run', 'own'), async (req, res) => {
  try {
    const [s] = await db.select().from(sessions).where(eq(sessions.id, req.params.id)).limit(1);
    if (!s) return res.status(404).json({ error: 'not found' });
    if (!isOwn(req, s.userId) || !isSameOrg(req, s.orgId))
      return res.status(403).json({ error: 'forbidden' });
    if (s.status !== 'in_progress')
      return res.status(409).json({ error: 'session already finalized' });

    const { text, signals = {} } = req.body || {};
    if (typeof text !== 'string' || !text.trim())
      return res.status(400).json({ error: 'text required' });

    const L = normLang(s.locale);
    const transcript = [...(s.transcript || []), { role: 'user', content: text }];

    // Anti-fraud flag computation (M2.3) — purely signal collection here.
    const flags = { ...(s.flags || {}) };
    if (signals.pasteSize && signals.pasteSize > 800) {
      flags.suspiciousPaste = (flags.suspiciousPaste || 0) + 1;
    }
    if (signals.typingMs && signals.typingMs > 0) {
      const cps = text.length / (signals.typingMs / 1000);
      if (cps > 40) flags.suspiciousTempo = (flags.suspiciousTempo || 0) + 1;
    }
    if (signals.deletes && signals.deletes > 20) {
      flags.heavyEdit = (flags.heavyEdit || 0) + 1;
    }

    const wellbeing = { ...(s.wellbeing || {}) };
    if (signals.frustrated) wellbeing.frustratedTurns = (wellbeing.frustratedTurns || 0) + 1;

    // Retrieve fresh chunks for THIS expert utterance + topic.
    const refQuery = `${s.topicLabel}\n${text}`;
    const { chunks } = await retrieveChunks({
      orgId: req.user.orgId,
      topicId: s.topicId,
      query: refQuery,
      k: 5,
    });
    const refBlock = formatReferenceBlock(chunks, L);

    // ---- Assessor first (so its next_focus can guide the next question) ----
    const previousResult = (
      await db.select().from(assessmentResults).where(eq(assessmentResults.sessionId, s.id)).limit(1)
    )[0];

    const ROLES = {
      ru: { user: 'Эксперт', assistant: 'Студент' },
      en: { user: 'Expert', assistant: 'Student' },
      uz: { user: 'Ekspert', assistant: 'Talaba' },
    };
    const r = ROLES[L];
    const transcriptText = transcript
      .map((m) => `${m.role === 'user' ? r.user : r.assistant}: ${m.content}`)
      .join('\n\n');

    const prevHint = previousResult?.competencies?.length
      ? `\n\nCurrent competency set (DO NOT change the set, only update score/evidence/gap/source_refs):\n${JSON.stringify(previousResult.competencies.map((c) => c.name))}`
      : '';

    const assessorSystem = [ASSESSOR_BASE, LANG[L].assessor, refBlock].filter(Boolean).join('\n\n');

    let parsedAssess = null;
    try {
      const { text: rawJson } = await getLLM().complete({
        system: assessorSystem,
        messages: [
          {
            role: 'user',
            content: `Topic: "${s.topicLabel}".\n\nDialogue transcript:\n${transcriptText}${prevHint}\n\nReturn JSON per the schema.`,
          },
        ],
        tier: 'assessor',
        maxTokens: 1800,
        cache: { ephemeral: true },
      });
      const parsed = JSON.parse(stripJson(rawJson));
      // Resolve source_refs[] (indices) into concrete refs using the chunk list.
      const resolveRef = (idx) => {
        const c = chunks[idx];
        if (!c) return null;
        return { documentId: c.documentId, documentName: c.documentName, chunkIndex: c.chunkIndex, page: c.page };
      };
      parsedAssess = {
        competencies: (parsed.competencies || []).map((c) => ({
          name: String(c.name || '').slice(0, 60),
          score: Math.max(0, Math.min(100, Number(c.score) || 0)),
          criterion: String(c.criterion || '').slice(0, 280),
          evidence: String(c.evidence || '').slice(0, 280),
          gap: !!c.gap,
          source_refs: Array.isArray(c.source_refs)
            ? c.source_refs.map(resolveRef).filter(Boolean).slice(0, 5)
            : [],
        })),
        next_focus: String(parsed.next_focus || '').slice(0, 60),
        overall: Math.max(0, Math.min(100, Number(parsed.overall) || 0)),
        strengths: (parsed.strengths || []).slice(0, 6).map((x) => String(x).slice(0, 200)),
        growth_zones: (parsed.growth_zones || parsed.gaps || []).slice(0, 6).map((x) => String(x).slice(0, 200)),
        recommendations: (parsed.recommendations || []).slice(0, 8).map((x) => String(x).slice(0, 200)),
      };
    } catch (err) {
      console.error('[sessions] assessor parse error', err);
    }

    // Upsert the assessment_results row.
    if (parsedAssess) {
      if (previousResult) {
        await db
          .update(assessmentResults)
          .set({
            competencies: parsedAssess.competencies,
            strengths: parsedAssess.strengths,
            gaps: parsedAssess.growth_zones,
            recommendations: parsedAssess.recommendations,
            nextFocus: parsedAssess.next_focus,
            sourceRefs: chunks.map((c) => ({
              documentId: c.documentId,
              documentName: c.documentName,
              chunkIndex: c.chunkIndex,
              page: c.page,
            })),
            updatedAt: new Date(),
          })
          .where(eq(assessmentResults.id, previousResult.id));
      } else {
        await db.insert(assessmentResults).values({
          sessionId: s.id,
          orgId: s.orgId,
          userId: s.userId,
          competencies: parsedAssess.competencies,
          strengths: parsedAssess.strengths,
          gaps: parsedAssess.growth_zones,
          recommendations: parsedAssess.recommendations,
          nextFocus: parsedAssess.next_focus,
          sourceRefs: chunks.map((c) => ({
            documentId: c.documentId,
            documentName: c.documentName,
            chunkIndex: c.chunkIndex,
            page: c.page,
          })),
          status: s.mode === 'assessment' ? 'pending_review' : 'auto',
        });
      }
    }

    // ---- Student next question ----
    const FOCUS_HINT = parsedAssess?.next_focus
      ? {
          ru: `\n\nВ ЭТОМ ходу копай в зону "${parsedAssess.next_focus}".`,
          en: `\n\nIN THIS turn dig into "${parsedAssess.next_focus}".`,
          uz: `\n\nBU navbatda "${parsedAssess.next_focus}" sohasini chuqurroq tekshiring.`,
        }[L]
      : '';

    const studentSystem = [
      STUDENT_BASE,
      LANG[L].student,
      `Conversation topic: "${s.topicLabel}".${FOCUS_HINT}`,
      refBlock,
      signals.frustrated ? STUDENT_SUPPORTIVE_SUFFIX : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const { text: nextQ } = await getLLM().complete({
      system: studentSystem,
      messages: transcript.map((m) => ({ role: m.role, content: m.content })),
      tier: 'student',
      maxTokens: 400,
      cache: { ephemeral: true },
    });

    const fullTranscript = [...transcript, { role: 'assistant', content: nextQ }];
    await db
      .update(sessions)
      .set({ transcript: fullTranscript, flags, wellbeing, updatedAt: new Date() })
      .where(eq(sessions.id, s.id));

    // Surface suspicious flag if threshold reached
    const totalSuspicious =
      (flags.suspiciousPaste || 0) + (flags.suspiciousTempo || 0);
    if (totalSuspicious >= 3) {
      await writeAudit({
        orgId: s.orgId,
        actorUserId: s.userId,
        action: 'session.flag_suspicious',
        targetType: 'session',
        targetId: s.id,
        meta: { flags },
      });
    }

    res.json({
      question: nextQ,
      assessment: parsedAssess,
      flags,
    });
  } catch (e) {
    console.error('[sessions] turn error', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- finalize ----------
sessionsRouter.post('/:id/finalize', requirePermission('session.run', 'own'), async (req, res) => {
  try {
    const [s] = await db.select().from(sessions).where(eq(sessions.id, req.params.id)).limit(1);
    if (!s) return res.status(404).json({ error: 'not found' });
    if (!isOwn(req, s.userId) || !isSameOrg(req, s.orgId))
      return res.status(403).json({ error: 'forbidden' });
    if (s.status !== 'in_progress') return res.json({ ok: true, session: s });

    const nextStatus = s.mode === 'assessment' ? 'pending_review' : 'auto_scored';
    const [updated] = await db
      .update(sessions)
      .set({ status: nextStatus, finalizedAt: new Date(), updatedAt: new Date() })
      .where(eq(sessions.id, s.id))
      .returning();

    await writeAudit({
      orgId: s.orgId,
      actorUserId: req.user.id,
      action: 'session.finalize',
      targetType: 'session',
      targetId: s.id,
      meta: { mode: s.mode, status: nextStatus },
    });

    const [result] = await db
      .select()
      .from(assessmentResults)
      .where(eq(assessmentResults.sessionId, s.id))
      .limit(1);

    // M3.3 — auto-schedule spaced reviews for weak competencies (<50)
    // on the user's own session.
    if (result && Array.isArray(result.competencies)) {
      const weak = result.competencies.filter(
        (c) => c && typeof c.score === 'number' && c.score < 50,
      );
      if (weak.length > 0) {
        try {
          const tomorrow = new Date(Date.now() + 86400_000);
          await db.insert(spacedReviews).values(
            weak.slice(0, 8).map((c) => ({
              orgId: s.orgId,
              userId: s.userId,
              topicId: s.topicId || null,
              competencyName: String(c.name || 'competency').slice(0, 60),
              lastScore: Math.max(0, Math.min(100, Math.round(c.score))),
              reviewAt: tomorrow,
              intervalDays: 1,
              easeFactor: 2.5,
            })),
          );
        } catch (e) {
          console.warn('[sessions] spaced-review autocreate failed:', e?.message || e);
        }
      }
    }

    res.json({ session: updated, result: result || null });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- convert practice → assessment (M2.5.1) ----------
sessionsRouter.post('/:id/convert', async (req, res) => {
  try {
    const [s] = await db.select().from(sessions).where(eq(sessions.id, req.params.id)).limit(1);
    if (!s) return res.status(404).json({ error: 'not found' });
    if (!isOwn(req, s.userId) || !isSameOrg(req, s.orgId))
      return res.status(403).json({ error: 'forbidden' });
    if (s.mode === 'assessment') return res.json({ session: s });

    const [updated] = await db
      .update(sessions)
      .set({ mode: 'assessment', updatedAt: new Date() })
      .where(eq(sessions.id, s.id))
      .returning();

    await db
      .update(assessmentResults)
      .set({ status: 'pending_review', updatedAt: new Date() })
      .where(eq(assessmentResults.sessionId, s.id));

    await writeAudit({
      orgId: s.orgId,
      actorUserId: req.user.id,
      action: 'session.convert_to_assessment',
      targetType: 'session',
      targetId: s.id,
      meta: { from: 'practice', to: 'assessment' },
    });

    res.json({ session: updated });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- Assessor override (M2.2) ----------
sessionsRouter.post(
  '/:id/override',
  requirePermission('assessment.override', 'org'),
  async (req, res) => {
    try {
      const { competencies, comment } = req.body || {};
      if (!Array.isArray(competencies)) return res.status(400).json({ error: 'competencies[] required' });
      if (!comment || typeof comment !== 'string')
        return res.status(400).json({ error: 'comment required' });

      const [s] = await db.select().from(sessions).where(eq(sessions.id, req.params.id)).limit(1);
      if (!s) return res.status(404).json({ error: 'not found' });
      if (!isSameOrg(req, s.orgId)) return res.status(404).json({ error: 'not found' });

      const [result] = await db
        .select()
        .from(assessmentResults)
        .where(eq(assessmentResults.sessionId, s.id))
        .limit(1);
      if (!result) return res.status(404).json({ error: 'no auto-result to override' });

      const sanitized = competencies.slice(0, 12).map((c) => ({
        name: String(c.name || '').slice(0, 60),
        score: Math.max(0, Math.min(100, Number(c.score) || 0)),
        criterion: String(c.criterion || '').slice(0, 280),
        evidence: String(c.evidence || '').slice(0, 280),
        gap: !!c.gap,
        source_refs: Array.isArray(c.source_refs) ? c.source_refs : [],
        overridden: true,
      }));

      const before = result.competencies;

      await db
        .update(assessmentResults)
        .set({
          competencies: sanitized,
          status: 'overridden',
          overriddenBy: req.user.id,
          overrideComment: comment.slice(0, 1000),
          overriddenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(assessmentResults.id, result.id));

      await db
        .update(sessions)
        .set({ status: 'finalized', finalizedAt: s.finalizedAt || new Date(), updatedAt: new Date() })
        .where(eq(sessions.id, s.id));

      await writeAudit({
        orgId: s.orgId,
        actorUserId: req.user.id,
        action: 'assessment.override',
        targetType: 'session',
        targetId: s.id,
        meta: { before, after: sanitized, comment },
      });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- learner appeal (M2.2) ----------
sessionsRouter.post('/:id/appeal', async (req, res) => {
  try {
    const { reason } = req.body || {};
    if (!reason || typeof reason !== 'string' || reason.length < 8)
      return res.status(400).json({ error: 'reason required (min 8 chars)' });

    const [s] = await db.select().from(sessions).where(eq(sessions.id, req.params.id)).limit(1);
    if (!s) return res.status(404).json({ error: 'not found' });
    if (!isOwn(req, s.userId) || !isSameOrg(req, s.orgId))
      return res.status(403).json({ error: 'forbidden' });

    const [result] = await db
      .select()
      .from(assessmentResults)
      .where(eq(assessmentResults.sessionId, s.id))
      .limit(1);
    if (!result) return res.status(404).json({ error: 'no result to appeal' });

    const [appeal] = await db
      .insert(assessmentAppeals)
      .values({
        resultId: result.id,
        orgId: s.orgId,
        userId: req.user.id,
        reason: reason.slice(0, 2000),
      })
      .returning();

    await writeAudit({
      orgId: s.orgId,
      actorUserId: req.user.id,
      action: 'assessment.appeal',
      targetType: 'session',
      targetId: s.id,
      meta: { appealId: appeal.id, reason: reason.slice(0, 200) },
    });

    res.json({ appeal });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

sessionsRouter.post(
  '/:id/appeal/:appealId/resolve',
  requirePermission('assessment.override', 'org'),
  async (req, res) => {
    try {
      const { status, resolution } = req.body || {};
      if (status !== 'accepted' && status !== 'rejected')
        return res.status(400).json({ error: 'status must be accepted|rejected' });
      const [appeal] = await db
        .select()
        .from(assessmentAppeals)
        .where(eq(assessmentAppeals.id, req.params.appealId))
        .limit(1);
      if (!appeal) return res.status(404).json({ error: 'not found' });
      if (appeal.orgId !== req.user.orgId) return res.status(404).json({ error: 'not found' });

      await db
        .update(assessmentAppeals)
        .set({
          status,
          resolution: String(resolution || '').slice(0, 1000),
          resolvedBy: req.user.id,
          resolvedAt: new Date(),
        })
        .where(eq(assessmentAppeals.id, appeal.id));

      await writeAudit({
        orgId: appeal.orgId,
        actorUserId: req.user.id,
        action: 'assessment.appeal_resolve',
        targetType: 'session',
        targetId: req.params.id,
        meta: { appealId: appeal.id, status, resolution },
      });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- review queue (HITL inbox) ----------
sessionsRouter.get(
  '/_review/queue',
  requirePermission('assessment.override', 'org'),
  async (req, res) => {
    try {
      const rows = await db
        .select({
          sessionId: sessions.id,
          topicLabel: sessions.topicLabel,
          userId: sessions.userId,
          finalizedAt: sessions.finalizedAt,
          resultId: assessmentResults.id,
        })
        .from(sessions)
        .innerJoin(assessmentResults, eq(assessmentResults.sessionId, sessions.id))
        .where(
          and(
            eq(sessions.orgId, req.user.orgId),
            eq(sessions.mode, 'assessment'),
            eq(assessmentResults.status, 'pending_review'),
          ),
        )
        .orderBy(desc(sessions.finalizedAt));
      res.json({ queue: rows });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);
