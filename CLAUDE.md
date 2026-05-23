# CLAUDE.md — FeynMap

Project context for Claude Code. Read this first before any non-trivial work.

## What this is

**FeynMap** is a "learn by explaining" trainer fused with a live competency radar. A user explains a topic to a naive AI "student" (Sonnet 4.6) while a hidden "assessor" (Haiku 4.5) scores demonstrated competencies in real time and feeds back `next_focus` to adapt the next question. Final screen surfaces gaps + recommendations.

Two product layers:

1. **Base FeynMap (MVP, shipped)** — single-user, no DB, no RAG. Self-contained chat + radar + report.
2. **FeynMap Corporate (planned)** — knowledge-base grounded, multi-role, with assignments and analytics. Adds Postgres+pgvector, RBAC, RAG, admin panel. Base layer stays intact underneath.

Brief sources live in `~/Downloads/` outside the repo: `claude-code-prompt-feynmap.md` (base spec), `DEV_PROMPT_corporate.md` (corporate layer), and `DEV_PROMPT_roadmap.md` (doработки: provider abstraction, i18n, trust/wellbeing, on-prem, integrations — M1→M5). Treat those as source of truth when they conflict with anything below.

## Repo layout

```
backend/                Express proxy to Anthropic. Single server.js for MVP.
  server.js             /chat (Student, Sonnet 4.6), /assess (Assessor, Haiku 4.5), /health
  .env                  ANTHROPIC_API_KEY — gitignored, never commit
frontend/               Vite + React + TS + Tailwind + recharts
  src/
    App.tsx             3 views: setup / session / report. localStorage persistence.
    api.ts              postChat / postAssess (with lang)
    i18n.ts             RU/EN/UZ dictionaries + useT/useLang hooks
    components/
      ChatPanel.tsx     left pane, bubbles, Cmd/Ctrl+Enter submit
      RadarPanel.tsx    recharts RadarChart, animated, empty state
      ReportScreen.tsx  final: radar + gaps + strengths + recs
      LangSwitcher.tsx  RU/EN/UZ toggle
docs/
  architecture.drawio   data-flow diagram, orthogonal edges, no crossings
  architecture_corporate.drawio   (planned, corporate-layer tabs + RBAC)
app.py, sample.ipynb    leftover Python skeleton — unrelated, ignore
```

## Stack

**Base layer (live):**
- Frontend: Vite 5, React 18, TypeScript, Tailwind 3, recharts 2
- Backend: Node 22 LTS, Express 4, `@anthropic-ai/sdk` 0.32
- Models: `claude-sonnet-4-6` (Student), `claude-haiku-4-5-20251001` (Assessor)
- State: React + `localStorage` only

**Corporate layer (planned, see Milestones):**
- DB: PostgreSQL 16 + pgvector
- ORM: Drizzle (preferred) or Prisma
- Auth: JWT + bcrypt, server-side RBAC middleware
- Doc parsing: `pdf-parse`, `mammoth` (DOCX), native MD/TXT
- Embeddings: **Voyage AI** (`voyage-3`, Anthropic ecosystem) — cloud for MVP, on-prem later
- Queue: BullMQ + Redis (or inline for first pass)
- Storage: local disk for MVP, S3-compatible after

## Run

```bash
# Backend
cd backend && npm install && npm run dev          # :8787

# Frontend (separate terminal)
cd frontend && npm install && npm run dev         # :5173, proxies /api → :8787

# Sanity
curl http://localhost:8787/health                 # {"ok":true}
```

`backend/.env` must contain `ANTHROPIC_API_KEY=sk-ant-...`. Frontend never sees the key.

**Node 22 LTS required.** Node 26 breaks esbuild's postinstall.

## Milestones

### Phase 0 — Base MVP ✅ DONE
- [x] Frontend + backend scaffold, README, `.env` flow
- [x] `/chat` Student loop with topic + history
- [x] `/assess` Assessor + safe JSON parsing (fence stripping, try/catch, sanitization)
- [x] Live RadarChart wired to Assessor output
- [x] Adaptive `next_focus` fed into next Student turn
- [x] Final report screen (gaps + strengths + recs)
- [x] i18n RU/EN/UZ runtime switch
- [x] `docs/architecture.drawio` — orthogonal, no edge crossings
- [x] Pushed to `github.com/mokhiya/feynmap`

### Phase 1 — DB + Auth + RBAC + Admin panel (in progress)
**Goal:** Foundation that everything else stands on. No KB or RAG yet.
**DB path:** local brew postgres@17 + pgvector (hackathon demo runs on the
laptop, no Docker required). `docker-compose.yml` ships as an optional
fallback only — see README.
- [x] Postgres 17 + pgvector via brew (docker-compose retained as fallback)
- [x] Drizzle schema for: Organization, User, Role, Permission, RolePermission, UserRole, MentorBinding, AuditLog
- [x] Initial migration generated + applied to local pg17
- [x] Seed: 16 permissions + 6 roles + 47-grant matrix + optional dev admin (verified idempotent)
- [ ] JWT login (`/auth/login`, `/auth/me`, `/auth/logout`), bcrypt password hash
- [ ] RBAC middleware: permission + scope check (own/team/org)
- [ ] Admin panel UI: user CRUD, role assignment, mentor binding, block/unblock, password reset
- [ ] CSV/XLSX user import (`POST /users/import`)
- [ ] All admin actions logged to `AuditLog`
- [ ] Backend refactor: `src/db/`, `src/auth/`, `src/rbac/`, `src/routes/` — `server.js` won't fit

**Definition of done:** Admin creates a user via UI or CSV, assigns role, the user logs in and sees only what their role permits.

### Phase 2 — Knowledge Base ingest
**Goal:** Documents land in pgvector, ready to ground sessions.
- [ ] `Document`, `DocumentChunk` entities (chunk has `embedding vector`, `page/section/heading` metadata)
- [ ] Upload endpoint: PDF/DOCX/TXT/MD validation, size/type checks
- [ ] Parser pipeline: text + structure (page, heading)
- [ ] Chunking: ~600–900 tokens, 15% overlap
- [ ] Embedding call (provider per Open Decision #2)
- [ ] pgvector index (ivfflat or hnsw)
- [ ] Status flow: `uploaded → parsing → indexed | failed`, visible to Admin
- [ ] Reindex + delete endpoints

**DoD:** Admin uploads a PDF, sees indexing progress, chunks are retrievable by similarity.

### Phase 3 — Topics, Lessons, Competencies
**Goal:** Curators carve KB into learnable units. Lessons are richer than the base spec — they have own intro material, quizzes, and attachments.
- [ ] `Topic`, `Competency` entities
- [ ] `Lesson` entity with: `ordered_topic_ids[]`, `intro_content` (markdown), `attachments[]`, optional `quiz_id`
- [ ] `Quiz`, `Question`, `QuestionOption` entities (MCQ + open-ended)
- [ ] `Attachment` entity (file ref, MIME, size, uploaded_by)
- [ ] Topic ↔ Document(s) link, optional chunk-level pinning
- [ ] `POST /topics/suggest` — AI drafts topics + competencies from a document
- [ ] Constructor UI: select doc → suggest topics → edit → publish
- [ ] Lesson builder UI: pick topics (drag-order) → write intro → attach files → build quiz
- [ ] Competency editor (name, description, weight) — Assessor role

**DoD:** Assessor uploads PMBoK, AI proposes 5–8 topics with competencies. Assessor publishes a Lesson combining 3 topics + a markdown intro + a 5-question quiz + 1 PDF attachment.

### Phase 4 — Assignments
**Goal:** HR / Assessor / Mentor push work to learners.
- [ ] `Assignment` entity (assignee, assigner, target_type, target_id, due_at, status)
- [ ] Assignments console: pick people/group → pick topic/lesson → deadline → assign
- [ ] Learner "Assigned to me" view with statuses + deadlines
- [ ] Overdue computation
- [ ] Free learners: catalog view + self-select. Assigned learners: catalog hidden.

**DoD:** Mentor assigns a lesson to 3 learners; they see it; status transitions work end-to-end.

### Phase 5 — RAG into the magic loop
**Goal:** Student and Assessor reference the loaded material. Sessions run in one of two modes.
- [ ] `Session.mode`: `assessment` | `practice` (default = `practice`)
  - `assessment` — final result locked until Assessor review (HITL mandatory)
  - `practice` — auto-score finalizes immediately, no HITL required, **not surfaced to HR analytics without explicit conversion** (wellbeing, Roadmap M2.5.1)
- [ ] `/chat`, `/assess` accept `topic_id` / `session_id` / `mode`
- [ ] Per-turn retrieval: top-k chunks by (topic, current expert utterance)
- [ ] Inject as **«Справочный материал (эталон)»** block in system prompts
- [ ] Assessor `evidence` references material; `source_refs` captures chunk IDs
- [ ] Contradiction with KB → explicit `gap=true`
- [ ] `Session`, `AssessmentResult` persisted to Postgres (not localStorage anymore)
- [ ] In `assessment` mode: result has `status: pending_review` until Assessor approves/overrides
- [ ] Aggregation queries (HR dashboards, team radar) MUST filter `mode = 'assessment'` by default

**DoD:** A `practice` session about uploaded PMBoK finalizes immediately with Assessor evidence pointing to specific pages and is invisible to HR. An `assessment` session waits in `pending_review` until a human Assessor signs off.

### Phase 6 — Analytics + Override
**Goal:** Aggregate insight + human-in-the-loop.
- [ ] `/analytics/learner/:id`, `/analytics/team`, `/analytics/org`
- [ ] Team/org radar (aggregated) + gap heatmap
- [ ] Individual report exports (per Open Decision: format)
- [ ] Assessor review screen: see auto-score, override score/comment, `overridden=true` flag
- [ ] AuditLog covers overrides

**DoD:** Org-wide radar shows weakest competency across all assessed users; Assessor can override a single score.

### Phase 7 — Role polish
- [ ] Hide inaccessible UI per role (server still enforces)
- [ ] Empty states for every role
- [ ] Per-role onboarding (first-login tour)
- [ ] Slide-ready demo path for each role

## Conventions

- **All LLM and embedding calls go through `LLMProvider` / `EmbeddingProvider` interfaces.** No direct `client.messages.create()` (or vendor-specific SDK calls) inside route handlers or business logic. Provider is selected by ENV/config — `anthropic` | `openai` | `local` (vLLM/OpenAI-compatible). This vshivaet Roadmap M1.1 as an architectural rule from the first line of corporate code so the later on-prem swap (M4.1) is a config flip, not a rewrite. Base MVP `server.js` predates this rule and will be refactored when Phase 1 lands.
- **No HTML `<form>`** in React — use `onClick` / `onChange` / explicit submit handlers.
- **Anthropic & OpenAI keys live on backend only.** Browser never sees them.
- **RBAC must be enforced server-side.** UI hiding is convenience, not security.
- **Scope-check every endpoint** (own / team / org). Never trust the path alone.
- **System prompts use `cache_control: ephemeral`** for prompt caching.
- **Assessor JSON is parsed defensively:** strip ```json fences, find outermost `{...}`, try/catch, sanitize fields (clamp 0..100, max string lengths).
- **Multi-tenancy by `org_id`** on every entity, even though MVP runs one org. Filter on every query.
- **AuditLog any sensitive action:** doc upload, assignment creation, score override, user role change.
- **Don't change the competency set mid-session.** Assessor builds it on turn 1, then only updates `score`/`evidence`/`gap`.
- Russian is the primary product language; UI strings live in `frontend/src/i18n.ts` with RU/EN/UZ dictionaries.
- **Don't commit `.env`.** `.gitignore` already covers it — verify before pushing.

## Diagram rules (drawio)

When editing `docs/*.drawio`:
- `edgeStyle=orthogonalEdgeStyle; rounded=0;` everywhere.
- Explicit `exitX/exitY/entryX/entryY` on every edge.
- Forward and return flows on different y-lanes (e.g., `exitY=0.3` forward vs `exitY=0.7` return).
- Use waypoints when an edge would otherwise cut through a block.
- Column gaps ≥ 80–120 px.
- Short labels: `промпт`, `вопрос`, `JSON-оценка`, `next_focus`.

## Resolved Decisions (locked in by techlead)

1. **Multi-tenancy:** schema is multi-tenant from day one — every entity carries `org_id`. Runtime serves one organization initially. Filter by `org_id` on every query.
2. **Embeddings:** **temporarily** cloud — **Voyage AI** (`voyage-3`, Anthropic-ecosystem) — for MVP. Target on-prem: **BGE-m3** locally (vLLM / Ollama) per Roadmap M4.1. The swap MUST be a config flip via the `EmbeddingProvider` abstraction (Roadmap M1.1) — zero changes to the RAG pipeline or call sites. Key lives only on backend.
3. **Lesson model is rich, not minimal:** ordered topics + own intro material (markdown) + attached files + own quiz. Drives extra entities: `Quiz`, `Question`, `QuestionOption`, `Attachment`. See Phase 3.
4. **Two session modes — `assessment` and `practice`:**
   - `assessment` — HITL mandatory. Auto-score is `pending_review` until Assessor approves or overrides. AuditLog every override. Triggered only by explicit assignment or user consent.
   - `practice` — auto-score finalizes immediately. No HITL gate. **Default mode.** Practice sessions are **private by default** and are NOT visible to HR analytics, mentors, or aggregated dashboards unless the user explicitly converts the session to `assessment` mode (wellbeing requirement per Roadmap M2.5.1). Practice sessions may still feed into the user's own progress/spaced-repetition signals.
   See Phase 5 for the `Session.mode` field and `AssessmentResult.status` flow.
5. **Learner roles:** two separate roles in the RBAC matrix — `learner_free` and `learner_assigned`. Not one role with a flag.
6. **Storage & auth (v1):** local disk for KB files and attachments, JWT + bcrypt for login. S3-compatible storage and SSO are explicitly out of scope for v1 and slated for a later phase.

## Helpful commands

```bash
# Smoke test backend with a real /chat call
curl -sS -X POST http://localhost:8787/chat \
  -H "content-type: application/json" \
  -d '{"topic":"TCP handshake","history":[],"lang":"ru"}'

# Same for /assess
curl -sS -X POST http://localhost:8787/assess \
  -H "content-type: application/json" \
  -d '{"topic":"TCP handshake","lang":"ru","history":[{"role":"assistant","content":"..."},{"role":"user","content":"..."}]}'

# Git: branch per phase
git checkout -b phase-1-auth-rbac

# Diagram regenerate (RBAC tab append)
# First fix the hardcoded path in gen_rbac_diagram.py to point to docs/architecture_corporate.drawio
python3 docs/gen_rbac_diagram.py
```

## When in doubt

- Conflicting requirements? Check `~/Downloads/claude-code-prompt-feynmap.md`, `~/Downloads/DEV_PROMPT_corporate.md`, and `~/Downloads/DEV_PROMPT_roadmap.md` — those are source of truth.
- Adding a new endpoint? It needs RBAC middleware and AuditLog entry.
- Adding a new model? It needs `org_id`, timestamps, and a Drizzle migration.
- Tempted to ship without backend permission check because UI hides the button? Don't.
