import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

// Resolve .env relative to THIS file, not process.cwd(). And override
// any inherited env from the parent process — Claude Desktop / Claude
// Code injects `ANTHROPIC_API_KEY=` (empty string) into spawned shells,
// which would otherwise silently mask the real key from .env.
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
  override: true,
});

import express from 'express';
import cors from 'cors';
import { getLLM } from './src/providers/index.js';

const PORT = process.env.PORT || 8787;

// Model selection lives inside the provider — see
// backend/src/providers/llm/anthropic.js. Routes only hint a `tier`
// ('student' | 'assessor') and the provider resolves to a model.
// This vshivaet Roadmap M1.1: business logic stays provider-agnostic.

// LLM is built lazily inside route handlers via getLLM() — it memoizes
// internally, so the cost is one function call per request. Lazy init
// means unit tests can import this file without an API key.

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------- system prompts ----------

const STUDENT_SYSTEM_BASE = `You are a naive, curious student. You do NOT know the topic being explained to you.
Your job: learn by asking short, concrete questions of the human expert.

Rules:
- Ask EXACTLY ONE short question per turn (1–2 sentences, no preamble).
- Latch onto unclear bits: if the expert uses an undefined term — ask what it means.
- Request concrete examples, everyday analogies, numeric illustrations.
- Never pretend to understand. No "got it", "thanks", "ok" filler — go straight to the question.
- Friendly, curious, but persistent.`;

const ASSESSOR_SYSTEM_BASE = `You are an invisible assessor. From the dialogue between the expert (user role) and the naive student (assistant role), you score how confidently the expert masters the topic.

RESPOND ONLY WITH VALID JSON. No markdown fences, no preamble, no comments. No text before or after the JSON.

Schema:
{
  "competencies": [
    {"name": "short competency name", "score": 0, "evidence": "1 phrase — what was shown/missed", "gap": false}
  ],
  "next_focus": "name of one competency from the list — where to dig next",
  "overall": 0
}

Rules:
- On the FIRST turn produce 5–7 key competencies for this topic. On subsequent turns DO NOT change the set — only update score and evidence.
- score ∈ [0, 100]. 0 = not shown at all, 100 = mastery with examples and nuance.
- gap = true if score < 40 OR the competency was not addressed in the dialogue.
- next_focus = name of the competency with the lowest score (prefer gap=true).
- overall = weighted average across all competencies.
- Competency names: short, up to 4 words.`;

const LANG_DIRECTIVE = {
  ru: {
    student: 'Отвечай ИСКЛЮЧИТЕЛЬНО на русском языке. Все вопросы — на русском.',
    assessor:
      'Все поля JSON (name, evidence, next_focus) — ИСКЛЮЧИТЕЛЬНО на русском языке.',
  },
  en: {
    student: 'Respond ONLY in English. All questions — in English.',
    assessor:
      'All JSON string fields (name, evidence, next_focus) — ONLY in English.',
  },
  uz: {
    student:
      "Faqat o\u2019zbek tilida javob ber. Barcha savollar \u2014 o\u2019zbekcha.",
    assessor:
      "JSONning barcha matn maydonlari (name, evidence, next_focus) \u2014 faqat o\u2019zbek tilida.",
  },
};

function normLang(l) {
  return l === 'ru' || l === 'en' || l === 'uz' ? l : 'ru';
}

// ---------- helpers ----------

function stripJson(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON not found in: ' + text.slice(0, 200));
  return t.slice(start, end + 1);
}

function toClaudeMessages(history) {
  // history: [{role: 'user'|'assistant', content: string}]
  // In our app: user = эксперт (explanation), assistant = студент (question)
  return history
    .filter(m => m && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content }));
}

// ---------- POST /chat — следующий вопрос Студента ----------

app.post('/chat', async (req, res) => {
  try {
    const { topic, history = [], nextFocus, lang } = req.body || {};
    if (!topic) return res.status(400).json({ error: 'topic required' });
    const L = normLang(lang);

    const KICK = {
      ru: `Тема, которую я буду тебе объяснять: "${topic}". Задай первый наивный вопрос, чтобы я начал.`,
      en: `The topic I will explain to you: "${topic}". Ask your first naive question to get me started.`,
      uz: `Men sizga tushuntiradigan mavzu: "${topic}". Boshlashim uchun birinchi sodda savolingizni bering.`,
    };
    const FOCUS_HINT = {
      ru: (f) => `\n\nВ ЭТОМ ходу копай в зону "${f}" — это слабое место эксперта.`,
      en: (f) => `\n\nIN THIS turn dig into the area "${f}" — it is the expert's weak spot.`,
      uz: (f) => `\n\nBU navbatda "${f}" sohasini chuqurroq tekshiring \u2014 ekspertning zaif joyi.`,
    };
    const TOPIC_LINE = {
      ru: `\n\nТема разговора: "${topic}".`,
      en: `\n\nConversation topic: "${topic}".`,
      uz: `\n\nSuhbat mavzusi: "${topic}".`,
    };

    const hint = nextFocus ? FOCUS_HINT[L](nextFocus) : '';

    const messages = toClaudeMessages(history);
    if (messages.length === 0) {
      messages.push({ role: 'user', content: KICK[L] });
    }

    const systemText =
      STUDENT_SYSTEM_BASE +
      '\n\n' +
      LANG_DIRECTIVE[L].student +
      TOPIC_LINE[L] +
      hint;

    const { text } = await getLLM().complete({
      system: systemText,
      messages,
      tier: 'student',
      maxTokens: 400,
      cache: { ephemeral: true },
    });

    res.json({ question: text });
  } catch (err) {
    console.error('/chat error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// ---------- POST /assess — обновлённая карта компетенций ----------

app.post('/assess', async (req, res) => {
  try {
    const { topic, history = [], previous, lang } = req.body || {};
    if (!topic) return res.status(400).json({ error: 'topic required' });
    if (!history.length) return res.json({ competencies: [], next_focus: '', overall: 0 });
    const L = normLang(lang);

    const ROLES = {
      ru: { user: 'Эксперт', assistant: 'Студент' },
      en: { user: 'Expert', assistant: 'Student' },
      uz: { user: 'Ekspert', assistant: 'Talaba' },
    };
    const PREV_HINT = {
      ru: (names) =>
        `\n\nТекущий список компетенций (НЕ меняй состав, обнови только score/evidence/gap):\n${JSON.stringify(names)}`,
      en: (names) =>
        `\n\nCurrent competency set (DO NOT change the set, only update score/evidence/gap):\n${JSON.stringify(names)}`,
      uz: (names) =>
        `\n\nJoriy kompetensiya ro\u2019yxati (tarkibni O\u2018ZGARTIRMA, faqat score/evidence/gap ni yangila):\n${JSON.stringify(names)}`,
    };
    const TAIL = {
      ru: (topic, transcript) =>
        `Тема: "${topic}".\n\nИстория диалога:\n${transcript}\n\nВерни JSON по схеме.`,
      en: (topic, transcript) =>
        `Topic: "${topic}".\n\nDialogue transcript:\n${transcript}\n\nReturn JSON per the schema.`,
      uz: (topic, transcript) =>
        `Mavzu: "${topic}".\n\nSuhbat tarixi:\n${transcript}\n\nSxema bo\u2019yicha JSON qaytar.`,
    };

    const roles = ROLES[L];
    const transcript = history
      .map((m) => `${m.role === 'user' ? roles.user : roles.assistant}: ${m.content}`)
      .join('\n\n');

    const prevHint = previous?.competencies?.length
      ? PREV_HINT[L](previous.competencies.map((c) => c.name))
      : '';

    const systemText = ASSESSOR_SYSTEM_BASE + '\n\n' + LANG_DIRECTIVE[L].assessor;

    const { text: raw } = await getLLM().complete({
      system: systemText,
      messages: [
        {
          role: 'user',
          content: TAIL[L](topic, transcript) + prevHint,
        },
      ],
      tier: 'assessor',
      maxTokens: 1500,
      cache: { ephemeral: true },
    });
    let parsed;
    try {
      parsed = JSON.parse(stripJson(raw));
    } catch (e) {
      console.error('Assessor parse error:', e, '\nRaw:', raw);
      return res.status(502).json({ error: 'assessor returned invalid JSON', raw });
    }

    // sanitize
    parsed.competencies = (parsed.competencies || []).map(c => ({
      name: String(c.name || '').slice(0, 60),
      score: Math.max(0, Math.min(100, Number(c.score) || 0)),
      evidence: String(c.evidence || '').slice(0, 280),
      gap: !!c.gap,
    }));
    parsed.next_focus = String(parsed.next_focus || '');
    parsed.overall = Math.max(0, Math.min(100, Number(parsed.overall) || 0));

    res.json(parsed);
  } catch (err) {
    console.error('/assess error:', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`FeynMap backend listening on http://localhost:${PORT}`);
});
