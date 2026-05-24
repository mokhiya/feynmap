# FeynMap — Архитектура решения

> Подробное описание архитектуры. Диаграммы: [`solution_architecture.drawio`](solution_architecture.drawio) (4 вкладки: Solution / RAG / Session sequence / RBAC), [`architecture.drawio`](architecture.drawio) (базовый поток данных), [`architecture_corporate.drawio`](architecture_corporate.drawio) (корпоративный слой). Открывать на [app.diagrams.net](https://app.diagrams.net).

---

## 1. Обзор

**FeynMap** — тренажёр «учусь, объясняя» с живой картой компетенций. Пользователь объясняет тему ИИ-«наивному Студенту»; невидимый ИИ-«Ассессор» по ходу диалога оценивает компетенции относительно эталона базы знаний, строит радар, бьёт следующим вопросом в слабую зону (`next_focus`) и в финале выдаёт отчёт: сильные стороны, зоны роста, рекомендации.

Продукт спроектирован в **двух слоях**, и корпоративный надстроен над базовым, не ломая его:

| Слой | Состав | Хранилище |
|---|---|---|
| **Базовый (MVP)** | `/chat` (Студент), `/assess` (Ассессор), живой радар, отчёт | без БД, `localStorage` |
| **Корпоративный** | то же ядро + RAG-заземление, multi-tenant, RBAC, назначения, аналитика, HITL, админка | PostgreSQL 17 + pgvector |

Ключевые архитектурные ставки:

1. **Provider-agnostic** — любая LLM/эмбеддер за единым интерфейсом; облако ↔ on-premise сменой ENV.
2. **RAG-grounding** — оценка ставится относительно загруженного эталона, с цитатами.
3. **Multi-tenant** — `org_id` на каждой бизнес-сущности.
4. **Security-by-design** — JWT + server-side RBAC со scope, append-only аудит.
5. **Trust & wellbeing** — прозрачный рубрик, human-in-the-loop, антифрод, психологическая безопасность.

---

## 2. Слои системы

См. вкладку **Solution Architecture**. Запрос идёт сверху вниз; провайдер-слой ведёт к облаку или on-premise.

| Слой | Технологии | Ответственность |
|---|---|---|
| **Клиент** | React 18 · Vite 5 · TS · Tailwind · recharts | UI сессии (чат + живой радар), отчёт, админка, i18n; JWT в `Authorization` |
| **API-граница** | Express 4 · helmet · CORS allowlist | заголовки безопасности, разбор тела (≤4 МБ), `requireAuth` → `requirePermission` |
| **Доменные маршруты** | Express routers | `auth · users · roles · mentor-bindings · documents · topics · sessions · assignments · analytics · reviews · role-targets` |
| **Сервисы ядра** | RAG · Provider abstraction · Trust/Wellbeing · Audit | заземление, вызовы моделей, контроль качества оценки |
| **Данные** | PostgreSQL 17 + pgvector · Drizzle ORM | реляционное хранилище + векторный поиск, всё под `org_id` |
| **Модели** | ☁ Anthropic / OpenAI / Voyage · 🖥 Qwen (vLLM) / Ollama bge-m3 | генерация и эмбеддинги — выбираются провайдер-слоем по ENV |

`server.js` поднимает Express, монтирует роутеры и оставляет у себя базовые `/chat`, `/assess`, `/health`. LLM-клиент строится **лениво** (`getLLM()` мемоизирует) — модуль можно импортировать в тестах без ключа.

---

## 3. Provider-agnostic слой

Единственная точка входа к моделям — `src/providers/`. Бизнес-логика **никогда** не вызывает SDK напрямую; только два интерфейса:

```js
import { getLLM, getEmbedder } from './providers/index.js';
const { text }    = await getLLM().complete({ system, messages, tier: 'student' });
const { vectors } = await getEmbedder().embed([query]);
```

- **`LLMProvider.complete({ system, messages, tier, model?, maxTokens?, cache? })`** → `{ text, model, provider, usage }`.
  `tier` (`'student'`|`'assessor'`) — подсказка «какой класс модели»; провайдер сам резолвит её в конкретную модель (Anthropic: Sonnet ↔ Haiku). Явный `model` побеждает.
- **`EmbeddingProvider.embed(texts[])`** → `{ vectors, dimensions, model, provider }`.
- **Фабрика** (`providers/index.js`) выбирает реализацию по `LLM_PROVIDER` / `EMBEDDING_PROVIDER` один раз на старте, через реестры `LLM_REGISTRY` / `EMBEDDING_REGISTRY`. Незнакомое значение → явная ошибка с перечнем валидных.

| Тип | Провайдер | Статус |
|---|---|---|
| LLM | `anthropic` (Sonnet 4.6 + Haiku 4.5) | ✅ реализован |
| LLM | `openai`, `local` (vLLM/Ollama, OpenAI-совместимый) | 🔌 интерфейс + контракт ENV; реализация по флипу (M4.1 — Qwen 32–72B) |
| Embeddings | `local` (Ollama **bge-m3**, 1024-dim, мультиязычный) | ✅ реализован |
| Embeddings | `voyage`, `openai` | 🔌 интерфейс готов |

**Промпт-кэширование.** Anthropic-провайдер шлёт системный промпт одним `ephemeral`-кэшируемым блоком — экономит токены на повторных ходах.

**Зачем.** Закон РУз требует хранить ПДн граждан в стране. Переезд на on-premise (Qwen + локальные эмбеддинги) — смена конфига, не переписывание. Данные не покидают периметр.

---

## 4. RAG-конвейер

См. вкладку **RAG Pipeline**. Две фазы:

### 4.1. Индексация (`src/rag/`)
```
upload → extract.js → chunk.js → EmbeddingProvider.embed() → document_chunks (pgvector)
```
- **extract.js** — `pdf-parse` (PDF, с границами страниц), `mammoth` (DOCX), utf8 (MD/TXT). MIME-валидация, лимит 25 МБ.
- **chunk.js** — ~700 токенов, ~15% overlap; жадная упаковка абзацев, при переполнении — разбиение по предложениям (ru/en/uz). Перенос «хвоста» предыдущего чанка для overlap.
- **embed** — через `EmbeddingProvider` (bge-m3 → 1024-dim).
- **store** — `document_chunks.embedding` (`vector(1024)`), статус документа `uploaded → parsing → indexed | failed`.

### 4.2. Заземление (`src/rag/retrieve.js`)
```
запрос (реплика эксперта + тема) → embed → pgvector cosine <=> top-k
   → фильтр по org_id (+ topic_id через topic_documents)
   → formatReferenceBlock() → системный промпт Студента и Ассессора
```
- Поиск — оператор pgvector `<=>` (cosine distance), `1 - distance` → score 0..1.
- **Цитируемость.** Эталонный блок нумерует фрагменты `[#1..k]`; Ассессор возвращает по каждой компетенции `criterion` (что есть мастерство) и `source_refs[]` (ссылки на использованные фрагменты) — видно, «за что» поставлен балл.
- **Изоляция.** Ретрив всегда ограничен `org_id` (multi-tenant); по теме — через связку `topic_documents`.

---

## 5. Модель данных

См. вкладку **RBAC & Data Model**. UUID-PK (`pgcrypto`), `org_id` на каждой бизнес-сущности, UTC-таймстемпы, статусы через PG-enum, мягкое состояние — `status`, без soft-delete пользователей (блок + аудит).

| Группа | Таблицы |
|---|---|
| Организация / доступ | `organizations` · `users` · `permissions` · `roles` · `role_permissions` (+scope) · `user_roles` · `mentor_bindings` · `audit_logs` |
| База знаний | `documents` (версия, статус, `chunk_count`) · `document_chunks` (`embedding vector(1024)`, page, heading) |
| Контент | `topics` · `topic_documents` · `competencies` (weight) · `lessons` · `lesson_topics` · `attachments` |
| Обучение / оценка | `assignments` · `sessions` · `assessment_results` · `assessment_appeals` |
| Развитие | `role_targets` (leveling) · `spaced_reviews` (интервальные повторения) |

`sessions` — ядро: `mode` (`practice`/`assessment`), `transcript` (JSONB), `flags` (антифрод), `wellbeing` (телеметрия), `doc_versions` (зафиксированные версии источников на старте — M5). `assessment_results` хранит `competencies` (с `criterion`/`source_refs`), `strengths`, `gaps`, `recommendations`, `status` и поля override.

Миграции — Drizzle (`src/db/migrations/`), сидер (`src/db/seed.js`) идемпотентен.

---

## 6. Аутентификация и авторизация

См. вкладки **Solution Architecture** (API-граница) и **RBAC & Data Model**.

- **AuthN:** JWT (`Authorization: Bearer`) + `bcrypt` (cost 12). `requireAuth` на всех бизнес-роутах; `/auth/login`, `/auth/me`, `/auth/logout`.
- **AuthZ:** `requirePermission(code, scope)` проверяет право **и область видимости** на сервере — `own` / `team` / `org`. UI ничего не решает.
- **16 прав × 6 ролей.** Матрица грантов — это **данные** (`role_permissions`), а не зашитые `if`. Пример: у `hr` есть `user.manage`, но **нет** `role.assign` — «управляет людьми, но не ролями» это строка матрицы.

Роли: `admin` · `hr` · `assessor` · `mentor` · `learner_free` · `learner_assigned` (+ `super_admin` лениво).

- **Аудит:** `audit_logs` append-only; `meta` (JSONB) хранит payload (для `assessment.override` — было/стало + комментарий). Логируются логины и их провалы, заведение/блок пользователей, назначение ролей, KB-загрузка/переиндексация, override и апелляции.
- **Секреты:** ключи только на бэке, `.env` в `.gitignore`, `JWT_SECRET` генерируется, dev-админ-сид выключается в `production`.

---

## 7. Жизненный цикл сессии

См. вкладку **Session — turn sequence**.

```
POST /sessions                 старт (mode=practice по умолчанию, привязка к topic/assignment)
POST /sessions/:id/turn        ход: auth → RBAC → retrieveChunks → Студент.complete
                               → Ассессор.complete (строгий JSON) → персист → { question, assessment }
POST /sessions/:id/finalize    финал: assessment_results.status auto → pending_review → approved | overridden
POST /sessions/:id/convert     practice → assessment (только по явному согласию, M2.5)
POST /sessions/:id/override    HITL: Ассессор переопределяет балл (+комментарий → аудит, M2.2)
POST /sessions/:id/appeal      обучающийся подаёт апелляцию
```

На каждом ходе оба вызова LLM (Студент и Ассессор) идут через provider-слой и получают эталонный RAG-блок. Безопасный парсинг JSON Ассессора: срезка ```` ```json ````-фенсов, `try/catch`, санитизация (clamp 0..100, обрезка строк).

---

## 8. Доверие, благополучие, развитие (Roadmap M2–M3)

- **M2.1 Прозрачный рубрик** — балл + `criterion` + `source_refs` (ссылка на эталон).
- **M2.2 Human-in-the-loop** — статусная машина результата + override с обязательным комментарием; апелляции (`assessment_appeals`).
- **M2.3 Антифрод** — `/turn` принимает `pasteSize`, `typingMs`, `deletes`; флаги считаются на сервере → `sessions.flags`.
- **M2.5 Психологическая безопасность** — приватная **«Практика»** vs **«Ассессмент»** (по согласию); поддерживающий тон Студента при сигналах фрустрации; язык **`growth_zones`** вместо «провалов».
- **M3.2 Leveling** — `role_targets`: целевой уровень компетенции под должность → отчёт gap-to-target.
- **M3.3 Интервальные повторения** — `spaced_reviews` (interval/ease-factor, SM-2): `GET /reviews/due`, `POST /reviews/:id/done`.

---

## 9. Мультиязычность

`RU / EN / UZ-Latn` — сквозная: словари UI, языковые директивы в системных промптах Студента/Ассессора, локализованные заголовки эталонного RAG-блока. Узбекская кириллица намеренно не поддерживается. `bge-m3` мультиязычен — один индекс на три языка.

---

## 10. Технологии и запуск

**Backend:** Node 22 LTS · Express 4 · Drizzle ORM · postgres-js · `@anthropic-ai/sdk` · `jsonwebtoken` · `bcrypt` · `helmet` · `multer` · `pdf-parse` v2 · `mammoth`.
**Frontend:** React 18 · Vite 5 · TypeScript 5 · Tailwind 3 · recharts 2.
**Data:** PostgreSQL 17 + `pgvector` + `pgcrypto`. **Локальный ИИ:** Ollama (`bge-m3`; Qwen — целевой on-prem).

Запуск (локально, без Docker): `brew` Postgres 17 + pgvector → `npm run db:migrate` → `npm run db:seed` → `npm run dev` (бэк :8787) + `npm run dev` (фронт :5173, проксирует `/api`). Подробно — в [`README.md`](../README.md). Docker-compose (`pgvector/pgvector:pg16`) — опциональный фолбэк.

---

## 11. Индекс диаграмм

| Файл / вкладка | Что показывает |
|---|---|
| `solution_architecture.drawio` → **Solution Architecture** | слои системы и связи (клиент → API → маршруты → ядро → данные → модели) |
| `solution_architecture.drawio` → **RAG Pipeline** | индексация документов + заземление сессии |
| `solution_architecture.drawio` → **Session — turn sequence** | sequence-диаграмма одного хода `/turn` |
| `solution_architecture.drawio` → **RBAC & Data Model** | роли/права/scope + группы сущностей |
| `architecture.drawio` | базовый слой: поток данных · адаптивный цикл · UX-флоу |
| `architecture_corporate.drawio` | корпоративный слой: поток · RAG · матрица RBAC |

---

## 12. Дорожная карта

| Фаза | Статус |
|---|---|
| 0 — Базовый MVP (Студент + Ассессор + радар + отчёт + i18n) | ✅ |
| 1 — Postgres+pgvector · Drizzle · JWT · RBAC · аудит · админка | ✅ |
| 2–6 — Локальный RAG (bge-m3) · KB · сессии · HITL · аналитика · апелляции | ✅ |
| M4.1 — On-prem LLM: Qwen 32–72B через vLLM | 🔜 |
| M5 — SSO/SAML · экспорт в LMS/HRIS · когортная аналитика | 🔜 |
