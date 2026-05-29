# CoPilot Sales

AI-ассистент менеджера по продажам. Десктопное приложение на **Svelte 4 + Vite 5 + Electron**, работает с двумя бэкендами: **Sales Agent** (подготовка к встрече) и **DialogScribe** (распознавание речи + LLM-аналитика).

Три экрана — подготовка к встрече, сопровождение звонка в реальном времени, итоги после встречи — каждый управляется своим AI-агентом.

---

## Архитектура

```
┌─────────────────────────────────────────────────────┐
│                    Electron Shell                    │
│  WASAPI Loopback (системный звук) + WASAPI Mic      │
├─────────────────────────────────────────────────────┤
│              Svelte 4 + Vite 5 (SPA)                │
│                                                     │
│  Orchestrator / Router                              │
│  ├── Prep Agent       → Sales Agent API (:8900)     │
│  ├── Live Advisor     → DialogScribe WS  (:7860)    │
│  └── Post-Meeting     → DialogScribe API (:7860)    │
├─────────────────────────────────────────────────────┤
│  Sales Agent API          │  DialogScribe API       │
│  (FastAPI, Python)        │  (FastAPI, Python)      │
│  ├── Mock CRM (JSON)      │  ├── GigaAM ASR        │
│  ├── OpenSearch (JSON)    │  │   (LiteLLM proxy)    │
│  ├── DuckDuckGo Search    │  ├── Pyannote диариз.   │
│  ├── СБАР (по ИНН)        │  ├── LLM-аналитика     │
│  └── GigaChat (LLM)      │  └── SQLite + JWT auth  │
└─────────────────────────────────────────────────────┘
```

---

## Экраны

### 📅 Сегодня — Prep Agent

- Список встреч на сегодня с тремя источниками данных: **Mock** / **Sales Agent API** / **CalDAV**
- При выборе встречи — панель **Client Dossier**:
  - **Статистика** — выручка, кол-во сотрудников, регион (из OpenSearch)
  - **Информация о компании** — отрасль, ОКВЭД, сайт, статус (из CRM)
  - **Сделки** — таблица с суммами, продуктами, статусами
  - **Контакты и ЛПР** — имя, должность, email, телефон
  - **История взаимодействий** — встречи, звонки, письма
  - **Новости** — из DuckDuckGo News с фильтром по новостным сайтам (РБК, Коммерсант, Ведомости, ТАСС)
  - **Вакансии** — с hh.ru через DuckDuckGo
  - **Рекомендуемые продукты** — из каталога, с подбором по отрасли клиента
  - **Анализ ИИ-агента** — LLM-анализ болей и рекомендации (GigaChat)
- Два режима сбора: **Агент** (с LLM, 30–60 сек) и **Прямой** (без LLM, 5–15 сек)

### 🎙️ В эфире — Live Advisor Agent

- WebSocket-подключение к DialogScribe (`/api/live-hints/ws`)
- Запись с микрофона (MediaRecorder, 6-секундные сегменты, base64 WebM)
- Каскадный индикатор:
  - **Fast layer** — локальный классификатор триггеров (цена, возражение, конкурент)
  - **Slow layer** — LLM генерирует контекстные подсказки через WebSocket
- Захват системного звука через WASAPI Loopback (нативный C++ addon)
- Таймер звонка + кнопка завершения → переход к Post-Meeting

### 📊 Итоги — Post-Meeting Agent

- Pipeline: `transcribe_file` → параллельные LLM-вызовы → `save_meeting`
- Результаты:
  - **Резюме** — полная сводка встречи
  - **Action Items** — чеклист с ответственными и приоритетами
  - **Ключевые решения** — согласованные договорённости
  - **Коучинг** — оценка компетенций (1–5) с рекомендациями
- Экспорт в CRM

---

## Бэкенды

### Sales Agent API (порт 8900)

Python FastAPI сервис для сбора карточек клиентов. Работает без Docker — использует JSON-файлы вместо реальных OpenSearch/CRM.

Репозиторий: [s-alyona-a/sales-agent](https://github.com/s-alyona-a/sales-agent)

| Эндпоинт | Назначение |
|---|---|
| `GET /health` | Проверка здоровья |
| `GET /api/meetings/today` | Встречи на сегодня (mock) |
| `POST /api/agent/collect-card` | Полный сбор с LLM-анализом |
| `POST /api/agent/collect-direct` | Быстрый сбор без LLM |
| `GET /api/cards?companyName=...` | Загрузка сохранённой карточки |
| `DELETE /api/cards?companyName=...` | Удаление карточки |

Vite проксирует `/agent-api/*` → `localhost:8900`.

### DialogScribe (порт 7860)

FastAPI сервис распознавания речи + LLM-аналитика. ASR через GigaAM (LiteLLM proxy), диаризация через pyannote (GPU).

Репозиторий: [Timik232/DialogScribe](https://github.com/Timik232/DialogScribe)

| Эндпоинт | Компонент | Назначение |
|---|---|---|
| `GET /health` | `AgentStatusBar` | Polling здоровья (каждые 30 сек) |
| `POST /api/auth/login` | `api.js` | Авто-логин → JWT |
| `WS /api/live-hints/ws` | `LiveAdvisor` | Аудио → транскрипт + подсказки |
| `POST /api/transcribe` | `PostMeeting` | Загрузка аудио → транскрипт |
| `POST /api/summary` | `PostMeeting` | Генерация резюме |
| `POST /api/insights` | `PostMeeting` | Извлечение action items |

Vite проксирует `/api/*`, `/health`, `/v1/*` → `localhost:7860`.

---

## Запуск

### Вариант A — Electron + Vite (рекомендуется)

```bash
# 1. Склонировать sales-agent рядом с copilot-sales
git clone https://github.com/s-alyona-a/sales-agent ../sales-agent
cd ../sales-agent
python -m venv venv
venv\Scripts\pip install -r requirements.txt
# Создать .env с GIGACHAT_API_KEY (опционально, для LLM-анализа)

# 2. Вернуться в copilot-sales
cd ../copilot-sales
npm install

# 3. Запуск (Vite + Electron одной командой)
npm run electron:dev
# Electron автозапускает sales-agent через venv
```

### Вариант B — Только фронтенд (Vite dev server)

```bash
npm install
npm run dev
# → http://localhost:5173

# Sales Agent API запускать отдельно:
cd ../sales-agent
venv\Scripts\python api_server.py --debug
```

### Вариант C — Full-stack Docker (с DialogScribe)

```bash
# Склонировать DialogScribe
git clone https://github.com/Timik232/DialogScribe ../DialogScribe

# Заполнить ключи в docker-compose.fullstack.yaml
docker compose -f docker-compose.fullstack.yaml up --build
# → http://localhost:5173 (nginx проксирует API)
```

### Сборка Windows-приложения

```bash
npm run electron:build
# → release/
```

---

## Структура проекта

```
src/
├── main.js
├── App.svelte                    # Корневой shell + роутер видов
├── lib/
│   ├── api.js                    # DialogScribe API клиент (JWT, авто-логин, retry)
│   ├── agentApi.js               # Sales Agent API клиент (сбор карточек, встречи)
│   └── caldav.js                 # CalDAV-интеграция для календаря
└── components/
    ├── Sidebar.svelte            # Навигация: Сегодня / Подготовка / В эфире / Итоги
    ├── AgentStatusBar.svelte     # Статусы агентов + health Sales Agent и DialogScribe
    ├── MeetingList.svelte        # Список встреч (Mock / API / CalDAV) + досье
    ├── ClientDossier.svelte      # Карточка клиента: CRM, OpenSearch, новости, продукты
    ├── ProductCard.svelte        # Карточка продукта из каталога
    ├── MeetingPrep.svelte        # Страница подготовки к встрече
    ├── LiveAdvisor.svelte        # Транскрипт + подсказки в реальном времени
    ├── PostMeeting.svelte        # Загрузка аудио → резюме, action items, коучинг
    └── Toast.svelte              # Уведомления

electron/
├── main.cjs                      # Electron main process, автозапуск Sales Agent
├── preload.cjs                   # Context bridge (IPC для аудио)
├── wasapi_loopback.cpp / .exe    # Нативный захват системного звука (WASAPI)
└── wasapi_mic.cpp / .exe         # Нативный захват микрофона (WASAPI)
```

---

## Стек технологий

| Слой | Технология |
|---|---|
| Фреймворк | [Svelte 4](https://svelte.dev) |
| Сборка | [Vite 5](https://vitejs.dev) |
| Десктоп | [Electron](https://www.electronjs.org) |
| Аудио | WASAPI Loopback + Mic (нативный C++) |
| Prep Agent бэкенд | [Sales Agent](https://github.com/s-alyona-a/sales-agent) (FastAPI + GigaChat) |
| ASR/LLM бэкенд | [DialogScribe](https://github.com/Timik232/DialogScribe) (FastAPI + GigaAM + LLM) |
| Стили | Scoped CSS, тёмная тема, без CSS-фреймворков |
| Шрифт | Inter (Google Fonts) |
| Состояние | Svelte stores + component props |
