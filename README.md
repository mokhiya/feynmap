<div align="center">

# 🪶 FeynMap

### Учишься, объясняя. Живая карта компетенций — в реальном времени.

**Метод Фейнмана как продукт:** ты объясняешь тему ИИ-«наивному студенту», а невидимый ИИ-«ассессор» по ходу диалога строит карту твоих компетенций, бьёт следующим вопросом точно в слабую зону и в финале выдаёт честный отчёт — что усвоено, где зоны роста и что подтянуть.

`React 18 · Vite 5` &nbsp;•&nbsp; `Node 22 · Express 4` &nbsp;•&nbsp; `PostgreSQL 17 + pgvector` &nbsp;•&nbsp; `Drizzle ORM` &nbsp;•&nbsp; `Provider-agnostic LLM` &nbsp;•&nbsp; `RAG` &nbsp;•&nbsp; `RU / EN / UZ`

</div>

---

## 📖 Что это

Тесты проверяют память. Резюме — обещания. **Кто проверит, что человек реально понял?**

FeynMap отвечает на этот вопрос механикой из двух ИИ-ролей, работающих одновременно:

| Роль | Модель (по умолчанию) | Что делает |
|---|---|---|
| 🤖 **Студент** | `claude-sonnet-4-6` | Наивный, любопытный. Задаёт по одному короткому вопросу за ход, цепляется за неясности, просит примеры. Следующий вопрос адаптивно летит в слабую зону (`next_focus`). |
| 🧐 **Ассессор** | `claude-haiku-4-5` | Невидим пользователю. По диалогу оценивает компетенции, отдаёт строгий JSON (балл + критерий + доказательство + ссылка на эталон), формирует радар, сильные стороны, зоны роста и рекомендации. |

Продукт живёт в **двух слоях**, и корпоративный надстроен над базовым, не ломая его:

- **Базовый (MVP)** — один цикл «объяснение → вопрос → оценка → радар». Без БД и RAG. Эндпоинты `/chat` и `/assess`.
- **Корпоративный** — то же ядро, но с заземлением на базу знаний (**RAG**), мульти-арендностью, ролями и правами, назначениями, аналитикой, человеческим ревью и админкой.

---

## ✨ Ключевые особенности

- 🔌 **Любая LLM через единый слой.** Провайдер выбирается одной переменной окружения. Облако сегодня → **on-premise завтра** без правок бизнес-логики.
- 📚 **RAG-заземление на эталон.** Сессия опирается на загруженную базу знаний; Ассессор ставит балл **относительно источника** и ссылается на конкретный фрагмент (`source_refs`).
- 🏢 **Multi-tenant с первого дня.** Каждая бизнес-сущность несёт `org_id` — данные изолированы по организации.
- 🔐 **Server-side RBAC.** 16 прав × 6 ролей × 3 области видимости (`own` / `team` / `org`). Права проверяются на сервере, не в UI.
- 🧠 **Прозрачная оценка + Human-in-the-loop.** У каждого балла — критерий и цитата эталона; Ассессор может переопределить авто-оценку, обучающийся — подать апелляцию.
- 🛡️ **Психологическая безопасность by design.** Режимы «Практика» / «Ассессмент», поддерживающий тон при фрустрации, язык «зон роста» вместо «провалов».
- 🕵️ **Антифрод.** Сигналы вставки больших фрагментов, темпа ввода и правок помечают подозрительные сессии.
- 🎯 **Leveling и доучивание.** Целевые уровни по должности (gap-to-target) и интервальные повторения (spaced repetition).
- 🌍 **Мультиязычность RU / EN / UZ-Latn** — насквозь: UI, промпты ролей, заголовки эталонного блока.
- 📜 **Append-only аудит** всех значимых действий.

---

## 🏛️ Архитектура

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Frontend — React 18 + Vite 5 + TS + Tailwind + recharts                   │
│  setup · session (чат + живой радар) · report · admin-панель               │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │  /api/*  (Vite-proxy, JWT в Authorization)
┌───────────────────────────────▼───────────────────────────────────────────┐
│  Backend — Node 22 + Express 4                                             │
│  helmet · CORS-allowlist · express.json                                    │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────────────┐│
│  │ requireAuth  │→ │ requirePermission │→ │ routes: auth users roles      ││
│  │ (JWT)        │  │ (perm + scope)    │  │ documents topics sessions ... ││
│  └──────────────┘  └──────────────────┘  └───────────────┬───────────────┘│
│                                                           │                │
│   ┌───────────────────────────┐      ┌───────────────────▼──────────────┐ │
│   │  RAG pipeline             │      │  Provider layer (единый интерфейс)│ │
│   │  extract → chunk → embed  │◀────▶│  LLMProvider · EmbeddingProvider  │ │
│   │  → pgvector cosine top-k  │      │  выбор по ENV; бизнес-логика не   │ │
│   │  → reference block        │      │  знает, облако это или on-prem    │ │
│   └────────────┬──────────────┘      └──────┬──────────────────┬─────────┘ │
└────────────────┼─────────────────────────────┼──────────────────┼──────────┘
                 │                              │                  │
        ┌────────▼─────────┐         ┌──────────▼─────────┐  ┌─────▼──────────┐
        │ PostgreSQL 17    │         │  ☁️  Облако         │  │ 🖥️  On-premise │
        │ + pgvector       │         │  Anthropic / OpenAI │  │ Qwen (vLLM) /  │
        │ (Drizzle ORM)    │         │  Voyage             │  │ Ollama bge-m3  │
        └──────────────────┘         └─────────────────────┘  └────────────────┘
```

Полные диаграммы — [`docs/architecture.drawio`](docs/architecture.drawio) (открыть на [app.diagrams.net](https://app.diagrams.net)).

---

## 🔌 Provider-agnostic слой — «любая LLM»

Сердце расширяемости. Вся бизнес-логика обращается к LLM и эмбеддингам **только** через два интерфейса — `LLMProvider.complete()` и `EmbeddingProvider.embed()`. Прямых вызовов SDK вне `src/providers/` нет. Конкретная реализация выбирается **одной переменной окружения** и резолвится один раз на старте.

```js
import { getLLM, getEmbedder } from './providers/index.js';

// бизнес-логика не знает, облако это или локальный Qwen:
const { text }    = await getLLM().complete({ system, messages, tier: 'student' });
const { vectors } = await getEmbedder().embed([query]);
```

`tier` (`'student'` | `'assessor'`) — подсказка «какой класс модели нужен»; провайдер сам резолвит её в конкретную модель (Anthropic: Sonnet ↔ Haiku; OpenAI: gpt-4o ↔ gpt-4o-mini; локальный стек может обслуживать оба одним Qwen).

| Тип | Провайдер | ENV | Статус |
|---|---|---|---|
| **LLM** | `anthropic` (Sonnet + Haiku) | `LLM_PROVIDER=anthropic` | ✅ Реализован |
| LLM | `openai` (gpt-4o / mini) | `LLM_PROVIDER=openai` | 🔌 Интерфейс готов |
| LLM | `local` (vLLM/Ollama, OpenAI-совместимый) | `LLM_PROVIDER=local` | 🔌 Интерфейс готов (M4.1: Qwen 32–72B) |
| **Embeddings** | `local` (Ollama **bge-m3**, 1024-dim, мультиязычный) | `EMBEDDING_PROVIDER=local` | ✅ Реализован |
| Embeddings | `voyage` (`voyage-3`) | `EMBEDDING_PROVIDER=voyage` | 🔌 Интерфейс готов |
| Embeddings | `openai` (`text-embedding-3`) | `EMBEDDING_PROVIDER=openai` | 🔌 Интерфейс готов |

> **Почему это важно.** Закон РУз требует хранить персональные данные граждан в стране. Переезд на on-premise (Qwen на своём железе + локальные эмбеддинги) — это смена конфига, а не переписывание продукта. Данные не покидают периметр.

Добавить нового провайдера = создать класс-наследник `LLMProvider`/`EmbeddingProvider` и зарегистрировать его в `src/providers/index.js`. Всё.

---

## 📚 RAG-конвейер

Корпоративные сессии **заземлены на эталон**: и Студент, и Ассессор получают в системный промпт релевантные фрагменты базы знаний, а Ассессор оценивает ответ **относительно источника** и ссылается на конкретный фрагмент.

```
upload (PDF/DOCX/MD/TXT, ≤25 МБ)
   │   src/rag/extract.js   — pdf-parse · mammoth · utf8, с границами страниц
   ▼
chunk                       src/rag/chunk.js
   │   ~700 токенов, ~15% overlap, разбиение по абзацам→предложениям, ru/en/uz
   ▼
embed                       EmbeddingProvider (bge-m3 → vector(1024))
   ▼
store                       document_chunks.embedding (pgvector)
   │   status: uploaded → parsing → indexed | failed
   ▼
retrieve                    src/rag/retrieve.js
   │   cosine <=> top-k, фильтр по org_id + (опц.) topic_id
   ▼
ground                      formatReferenceBlock() → системный промпт
       «Справочный материал (эталон). Опирайся на него, выявляй противоречия»
       → Ассессор возвращает source_refs[] (ссылки на использованные фрагменты)
```

- **Цитируемость.** Каждая компетенция в отчёте несёт `criterion` (что считается мастерством) и `source_refs` (индексы фрагментов эталона) — видно, «за что» поставлен балл.
- **Мульти-арендность ретрива.** Поиск всегда ограничен `org_id`; по теме — через связку `topic_documents`.
- **Векторный поиск** — оператор pgvector `<=>` (cosine distance), `1 - distance` → score 0..1.

---

## 🗄️ Модель данных (Drizzle + Postgres 17)

UUID-первичные ключи (`pgcrypto`), `org_id` на каждой бизнес-сущности, `created_at/updated_at` в UTC, статусы — через PG-enum.

| Группа | Таблицы |
|---|---|
| **Организация и доступ** | `organizations`, `users`, `permissions`, `roles`, `role_permissions` (+scope), `user_roles`, `mentor_bindings`, `audit_logs` |
| **База знаний (RAG)** | `documents` (+версия, статус, chunk_count), `document_chunks` (`embedding vector(1024)`, page/heading) |
| **Контент** | `topics`, `topic_documents`, `competencies` (+weight), `lessons`, `lesson_topics`, `attachments` |
| **Обучение** | `assignments`, `sessions`, `assessment_results`, `assessment_appeals` |
| **Развитие** | `role_targets` (leveling), `spaced_reviews` (интервальные повторения) |

`sessions` — ядро: `mode` (`practice`/`assessment`), `transcript` (JSONB), `flags` (антифрод), `wellbeing` (телеметрия), `doc_versions` (зафиксированные версии источников на момент старта — M5).

---

## 🔐 Безопасность и RBAC

- **Аутентификация:** JWT (`Authorization: Bearer …`) + `bcrypt` (cost 12). `requireAuth` на всех бизнес-роутах.
- **Авторизация:** `requirePermission(code, scope)` — проверка права **и области видимости** на сервере (`own` / `team` / `org`). UI ничего не решает.
- **16 прав × 6 ролей.** Матрица — данные (`role_permissions`), а не зашитые `if`. Например, у HR есть `user.manage`, но **нет** `role.assign` — «управляет людьми, но не ролями» это строка в матрице, а не скрытое условие.

| Роль | Кратко |
|---|---|
| `admin` | Организация целиком: пользователи, роли, БЗ, аналитика, override |
| `hr` | Назначения, аналитика по оргу, управление людьми (без ролей) |
| `assessor` | Владеет компетенциями, ревью и override авто-оценок |
| `mentor` | Назначает и смотрит **своих** обучающихся (`team`) |
| `learner_free` | Сам выбирает тему из каталога, видит свои результаты |
| `learner_assigned` | Проходит назначенное, видит свои результаты |

- **Заголовки:** `helmet`. **CORS:** allowlist через `CORS_ORIGINS`.
- **Аудит:** `audit_logs` — append-only, `meta` (JSONB) хранит payload действия (например, для `assessment.override` — было/стало + комментарий). Логируются логины, провалы логина, заведение/блок пользователей, назначение ролей, загрузка/переиндексация БЗ, override и апелляции.
- **Секреты:** ключи только на бэке, `.env` в `.gitignore`, `JWT_SECRET` генерируется (`openssl rand -hex 32`), seed dev-админа отключается в `production`.

---

## 🧭 Доверие, благополучие, развитие (Roadmap M2–M3)

- **M2.1 Прозрачный рубрик** — балл сопровождается критерием и ссылкой на эталон (`criterion`, `source_refs`).
- **M2.2 Human-in-the-loop** — `assessment_results.status`: `auto → pending_review → approved | overridden`; override с обязательным комментарием → в аудит. Апелляция обучающегося (`assessment_appeals`).
- **M2.3 Антифрод** — `/sessions/:id/turn` принимает `pasteSize`, `typingMs`, `deletes`; флаги считаются на сервере и пишутся в `sessions.flags`.
- **M2.5 Психологическая безопасность** — режим **«Практика»** (приватный, без ярлыков) отделён от **«Ассессмента»** (по явному согласию, `/sessions/:id/convert`); при сигналах фрустрации Студент переходит на поддерживающий тон; в отчёте — «зоны роста» (`growth_zones`) вместо «провалов».
- **M3.2 Leveling** — `role_targets`: целевой уровень компетенции под должность, отчёт показывает gap-to-target.
- **M3.3 Интервальные повторения** — `spaced_reviews` (interval / ease-factor, SM-2-подобно): `GET /reviews/due`, `POST /reviews/:id/done`.

---

## 🌍 Мультиязычность

`RU / EN / UZ-Latn` — сквозная: словари UI (`frontend/src/i18n.ts`), языковые директивы в системных промптах Студента/Ассессора, локализованные заголовки эталонного RAG-блока. Узбекская кириллица намеренно не поддерживается (нормализация Latn↔Cyrl не делается). `bge-m3` мультиязычен — один индекс на все три языка.

---

## 🔗 API (основное)

Все бизнес-роуты — за `requireAuth`; мутации — за `requirePermission(code, scope)`.

| Группа | Эндпоинты |
|---|---|
| **Auth** | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` |
| **Users** | `GET /users` · `GET /users/:id` · `POST /users` · `PATCH /users/:id` |
| **Roles / Mentor** | `GET /roles` · `…/mentor-bindings` (bind/unbind) |
| **Knowledge Base** | `POST /documents` (upload+parse+chunk+embed) · `GET /documents` · `GET /documents/:id` · reindex / delete |
| **Topics** | `GET /topics` · `GET /topics/published` · `POST /topics` · `PATCH/DELETE /topics/:id` |
| **Sessions** ⭐ | `POST /sessions` (start) · `POST /sessions/:id/turn` (RAG-grounded ход: вопрос Студента + апдейт Ассессора) · `POST /sessions/:id/finalize` · `POST /sessions/:id/convert` (practice→assessment) · `POST /sessions/:id/override` · `POST /sessions/:id/appeal` |
| **Assignments** | `GET /assignments` · `POST /assignments` · `POST /assignments/:id/complete` |
| **Analytics** | `GET /analytics/me` · `GET /analytics/learner/:id` · org/team агрегаты |
| **Leveling / Repetition** | `GET /role-targets` · `GET /role-targets/by-role/:roleLabel` · `GET /reviews/due` · `POST /reviews/:id/done` |
| **Base MVP** | `POST /chat` · `POST /assess` · `GET /health` |

---

## 🧱 Технологии

**Frontend:** React 18, Vite 5, TypeScript 5, Tailwind 3, recharts 2.
**Backend:** Node 22 LTS, Express 4, Drizzle ORM 0.36, `postgres` (postgres-js), `@anthropic-ai/sdk`, `jsonwebtoken`, `bcrypt`, `helmet`, `multer`, `pdf-parse` v2, `mammoth`.
**Data:** PostgreSQL 17 + `pgvector`, `pgcrypto`.
**Локальный ИИ:** Ollama (`bge-m3` эмбеддинги; Qwen для LLM — целевой on-prem).

---

## 🤖 Раскрытие используемых AI

Полная прозрачность по ИИ-компонентам.

**Модели**
- `claude-sonnet-4-6` (Anthropic) — роль **«Студент»** (наводящие вопросы).
- `claude-haiku-4-5` (Anthropic) — роль **«Ассессор»** (оценка → строгий JSON).
- `bge-m3` (BAAI, 1024-dim, мультиязычный) — эмбеддинги для RAG, **локально через Ollama**.
- (целевой on-prem, M4.1) **Qwen 32–72B** через vLLM — как LLM-провайдер `local`.

**API / сервисы**
- **Anthropic Messages API** (`@anthropic-ai/sdk`) — единственный внешний ИИ-API в текущей сборке; ключ только на бэкенде, в браузер не попадает.
- **Ollama HTTP API** (`/api/embed`) — локально, для эмбеддингов; данные наружу не уходят.
- Provider-абстракция позволяет переключить LLM/эмбеддер на OpenAI / Voyage / локальный стек сменой одной ENV (см. «Provider-agnostic слой»).

**Агенты / роли.** Не autonomous-агенты с инструментами, а **две ролевые LLM** (Студент / Ассессор) — два независимых вызова на ход, разные модели через `tier`.

**Промпты** — в коде, не скрыты: `backend/server.js` (база) и `backend/src/routes/sessions.js` (корпоративный, RAG-grounded) — константы `STUDENT_*`, `ASSESSOR_*` + языковые директивы RU/EN/UZ.

**RAG.** Источник — документы организации (PDF/DOCX/MD/TXT) из админки. Чанкинг ~700 ток / 15% overlap → эмбеддинги bge-m3 → pgvector (cosine top-k) → эталонный блок в промпт; Ассессор ссылается на фрагменты (`source_refs`).

**Датасеты / дообучение.** Своих обучающих датасетов нет, модели **не файнтюнились**. Единственные «данные» = загруженная пользователем база знаний (используется только в RAG на инференсе).

**Шаблоны / внешние ассеты.** Стороннего код-бойлерплейта нет; библиотеки — open-source из npm (см. «Технологии»). Демо-ролик и диаграммы (`video/`, `docs/`) — вспомогательные, в рантайм продукта не входят.

---

## 🚀 Запуск (локально, без Docker)

Хакатон-демо целиком крутится на ноутбуке. Postgres — нативно через brew, `pgvector` тянется вместе с ним.

```bash
# 1. Postgres 17 + pgvector (один раз)
brew install postgresql@17 pgvector
brew services start postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
createdb feynmap
psql feynmap -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 2. Конфиг
cp backend/.env.example backend/.env
#   ANTHROPIC_API_KEY=sk-ant-...
#   DATABASE_URL=postgres://$(whoami)@localhost:5432/feynmap
#   JWT_SECRET=$(openssl rand -hex 32)
#   SEED_DEV_ADMIN=true  +  SEED_DEV_PASSWORD=...   (для первого запуска)

# 3. Backend
cd backend
npm install
npm run db:migrate    # миграции Drizzle
npm run db:seed       # 16 прав + 6 ролей + матрица грантов + dev-admin (идемпотентно)
npm run dev           # http://localhost:8787   →  GET /health → {"ok":true}

# 4. Frontend (другой терминал)
cd frontend
npm install
npm run dev           # http://localhost:5173  (Vite проксирует /api → :8787)
```

> **Node 22 LTS обязателен** (Node 26 ломает postinstall esbuild).

### RAG локально (опционально, для заземления на БЗ)
```bash
ollama pull bge-m3
# в backend/.env:
#   EMBEDDING_PROVIDER=local
#   EMBEDDING_LOCAL_BASE_URL=http://localhost:11434
#   EMBEDDING_LOCAL_MODEL=bge-m3
```

### Docker (опциональный фолбэк)
```bash
docker compose up -d   # pgvector/pgvector:pg16
# DATABASE_URL=postgres://feynmap:feynmap@localhost:5432/feynmap
```

---

## ⚙️ Переменные окружения

Скопировать `backend/.env.example` → `backend/.env` (он в `.gitignore` — реальные значения не коммитим).

| Переменная | Назначение | Пример / плейсхолдер |
|---|---|---|
| `ANTHROPIC_API_KEY` | ключ Anthropic (только на бэке) | `sk-ant-...` |
| `DATABASE_URL` | строка подключения Postgres | `postgres://<user>@localhost:5432/feynmap` |
| `JWT_SECRET` | секрет подписи JWT | сгенерировать: `openssl rand -hex 32` |
| `JWT_TTL` | время жизни токена | `7d` |
| `PORT` | порт бэкенда | `8787` |
| `NODE_ENV` | окружение | `development` · `production` |
| `CORS_ORIGINS` | allowlist origin'ов через запятую | `https://app.example.com` (пусто = всё разрешено в dev) |
| `LLM_PROVIDER` | провайдер LLM | `anthropic` (по умолч.) · `openai` · `local` |
| `EMBEDDING_PROVIDER` | провайдер эмбеддингов | `local` (bge-m3) · `voyage` · `openai` |
| `EMBEDDING_LOCAL_BASE_URL` / `EMBEDDING_LOCAL_MODEL` | локальный эмбеддер (Ollama) | `http://localhost:11434` · `bge-m3` |
| `LLM_LOCAL_BASE_URL` / `LLM_LOCAL_MODEL` | on-prem LLM (vLLM/Ollama) | `http://localhost:8000/v1` · `Qwen/Qwen2.5-32B-Instruct` |
| `SEED_ORG_SLUG` / `SEED_ORG_NAME` | организация по умолчанию для seed | `feynmap-dev` |
| `SEED_DEV_ADMIN` | создать dev-админа при seed | `true` (в `production` игнорируется) |
| `SEED_DEV_EMAIL` / `SEED_DEV_PASSWORD` | логин/пароль dev-админа | см. «Демо-доступ» ↓ |

---

## 🔑 Демо-доступ

Учётные записи создаёт сидер. Чтобы у развёрнутого инстанса сразу был рабочий вход, засидите dev-админа этими значениями:

```bash
# backend/.env
SEED_DEV_ADMIN=true
SEED_DEV_EMAIL=admin@feynmap.local
SEED_DEV_PASSWORD=FeynMap!Demo2026
```
```bash
npm run db:migrate && npm run db:seed   # идемпотентно
```

**Демо-логин (роль Administrator):**

| Поле | Значение |
|---|---|
| URL фронта | `http://localhost:5173` |
| **Логин** | `admin@feynmap.local` |
| **Пароль** | `FeynMap!Demo2026` |

Под админом доступно всё: завести пользователей и назначить роли (Наставник / HR / Ассессор / Обучающийся), загрузить документ в Базу знаний, создать тему, пройти сессию и посмотреть аналитику. Прочие роли создаются из админ-панели (отдельного сид-набора для них нет).

> ⚠️ Это демонстрационный пароль. В реальном проде задайте свой `SEED_DEV_PASSWORD` и смените после первого входа. Сид dev-админа **автоматически отключается при `NODE_ENV=production`**.

---

## 🎬 Демо

- Анимационный обзор продукта: [`video/FeynMap_animated.mp4`](video/FeynMap_animated.mp4).
- Нетехническое описание и руководство пользователя — в [`docs/`](docs/) (`FeynMap_описание.docx`, `user_guide.html`).
- **Сценарий живого демо:**
  1. Войти админом → загрузить документ по теме в Базу знаний (дождаться статуса `indexed`).
  2. Создать тему и связать с документом.
  3. Запустить сессию, объяснять короткими сообщениями — Студент переспрашивает, радар справа заполняется в реальном времени.
  4. «Завершить» → отчёт: сильные стороны, зоны роста, рекомендации и ссылки на эталон.

---

## ✅ Проверка сборки и запуска (build / run evidence)

```bash
# 1. health-check работающего бэкенда
curl http://localhost:8787/health          # → {"ok":true}

# 2. автотесты деплоя — встроенный node:test, без доп. зависимостей
cd backend && node --test test/
#    unit (чанкер, provider-фабрика) — всегда;
#    db-deploy (расширения, таблицы, seed, pgvector) — если задан DATABASE_URL;
#    http-smoke (/health, guard 401, login→JWT→/me) — если поднят сервер.

# 3. post-deploy gate против развёрнутого URL (ненулевой код при провале)
SMOKE_BASE_URL=http://localhost:8787 \
SMOKE_EMAIL=admin@feynmap.local SMOKE_PASSWORD=FeynMap!Demo2026 \
node scripts/deploy-check.mjs
```

**CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) на каждый push в `main` / PR поднимает `pgvector/pgvector:pg17`, применяет миграции и seed, гоняет `node --test` и smoke. Детали — [`backend/test/README.md`](backend/test/README.md).

---

## 🗂️ Структура репозитория

```
backend/
  server.js                  Express bootstrap, base /chat /assess /health, монтаж роутеров
  src/
    providers/               🔌 единственная точка входа к моделям
      index.js               фабрика (выбор по ENV) + getLLM()/getEmbedder()
      llm/        base · anthropic ✅ · openai 🔌 · local 🔌
      embedding/  base · local ✅(bge-m3) · voyage 🔌 · openai 🔌
    rag/                     extract · chunk · retrieve (RAG-конвейер)
    db/                      schema · migrations · migrate · seed (Drizzle)
    auth/                    jwt · password (bcrypt) · requireAuth · audit
    rbac/                    requirePermission (perm + scope own/team/org)
    routes/                  auth users roles mentorBindings documents topics
                             sessions assignments analytics reviews roleTargets
frontend/
  src/
    App.tsx                  setup / session / report
    auth.tsx                 контекст авторизации, JWT
    api.ts · i18n.ts · types.ts
    components/              ChatPanel · RadarPanel · ReportScreen · LangSwitcher
                             LoginScreen · AdminPanel · AdminUsers · AdminDocuments
                             AdminTopics · AdminReview · AdminMentorBindings
docs/architecture.drawio
docker/ · docker-compose.yml  опциональный pgvector
```

---

## 🗺️ Дорожная карта

| Фаза | Содержание | Статус |
|---|---|---|
| **0** | Базовый MVP: Студент + Ассессор + живой радар + отчёт + i18n | ✅ |
| **1** | Postgres+pgvector · Drizzle-схема · JWT-auth · RBAC · аудит · админка | ✅ |
| **2–6** | Локальный RAG (bge-m3) · KB · сессии · HITL · аналитика · апелляции | ✅ |
| **M4.1** | On-prem LLM: Qwen 32–72B через vLLM (`local`-провайдер) | 🔜 |
| **M5** | SSO/SAML · экспорт в LMS/HRIS · когортная аналитика | 🔜 |

---

<div align="center">

**FeynMap** — _понял тот, кто может объяснить просто._

</div>
