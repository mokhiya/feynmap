# FeynMap — учусь, объясняя + живая карта компетенций

Двухдневный хакатон-проект. Пользователь объясняет тему ИИ-«наивному студенту»,
параллельно ИИ-«ассессор» оценивает компетенции и строит живой радар. В финале —
карта навыков, пробелы и короткие рекомендации.

## Стек
- **Frontend:** React + Vite + TypeScript + Tailwind + recharts
- **Backend:** Node + Express прокси к Anthropic Claude
- **Модели:** `claude-sonnet-4-6` (Студент), `claude-haiku-4-5-20251001` (Ассессор)

## Структура
```
backend/   — Express API (/chat, /assess), ключ Anthropic только здесь
frontend/  — React-приложение, чат + радар + финальный отчёт
docs/      — architecture.drawio
```

## Запуск

### 1. Ключ Anthropic
Создайте файл `backend/.env` со своим ключом (файл уже в `.gitignore`):
```
ANTHROPIC_API_KEY=sk-ant-...
PORT=8787
```

### 2. Backend
```bash
cd backend
npm install
npm run dev          # слушает на http://localhost:8787
```

### 3. Frontend
В другом терминале:
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```
Vite-прокси перенаправит `/api/*` на бэкенд.

## Демо-сценарий
1. Открыть фронт, ввести тему (например, «TCP handshake» или «Энтропия в термодинамике»).
2. Объяснять короткими сообщениями — Студент будет переспрашивать.
3. Справа в реальном времени обновляется радар компетенций.
4. Через 5–8 ходов — кнопка «Завершить» → финальный отчёт с пробелами и рекомендациями.

## Архитектура
См. [`docs/architecture.drawio`](docs/architecture.drawio) — откройте на
[app.diagrams.net](https://app.diagrams.net).
