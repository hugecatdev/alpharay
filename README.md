# AlphaRay — умный кредитный кабинет

Прототип цифрового кредитного конвейера для малого бизнеса: кабинет предпринимателя, кабинет андеррайтера и ИИ-ассистент Рэй. Данные и состояние заявок хранятся в PostgreSQL, этапы конвейера выполняет отдельный воркер.

- `frontend/` — React + Vite, nginx в Docker ([README](frontend/README.md), тестовые учётки — [DEMO_ACCOUNTS.txt](frontend/DEMO_ACCOUNTS.txt));
- `backend/` — FastAPI + SQLAlchemy + Alembic: конвейер и воркер, проверки, скоринг и кредитные правила, договор, кабинет андеррайтера, администрирование банка, ассистент ([README](backend/README.md));
- [`docs/architecture.md`](docs/architecture.md) — архитектура: контекст, контейнеры, компоненты, статусы и переходы, сквозной кредитный путь, данные, ассистент, безопасность и надёжность, путь к промышленной версии;
- `docs/api/openapi.json` — схема API, `docs/prompts/` — исходное ТЗ.

## Запуск в Docker

```bash
cp backend/.env.example backend/.env    # по желанию: ключ LLM для Рэя
docker compose up --build               # http://localhost:8080, пароль у всех учёток — demo
```

Поднимаются `postgres` (PostgreSQL 17), `backend` (API), `worker` (конвейер) и `frontend` (nginx). При первом старте бэкенд применяет миграции и загружает демо-данные; при следующих — данные сохраняются. Данные лежат в томах `postgres-data` и `backend-data` (загруженные файлы). Сбросить демо: `docker compose exec backend python -m app.cli reset-demo` или `docker compose down -v`.

Проверить готовность: `http://localhost:8080/api/health/ready`. Логи — JSON, у каждого запроса `X-Request-ID`, он же — `correlation_id` в ошибках и истории заявки.

## ИИ-ассистент и LLM

Рэй работает через любой OpenAI-совместимый API с моделью с открытыми весами. Провайдер задаётся в `backend/.env`:

```bash
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=openai/gpt-oss-120b
```

Без ключа Рэй скрыт, а весь сценарий проходит формами — платные ресурсы для проверки не нужны. Локальная модель без внешних сервисов:

```bash
# backend/.env: LLM_BASE_URL=http://ollama:11434/v1  LLM_API_KEY=ollama  LLM_MODEL=qwen3:8b
docker compose --profile ollama up --build
```

Модель для профиля `ollama` задаётся `OLLAMA_MODEL` (по умолчанию `qwen3:8b`) и скачивается при первом запуске.

## Тесты

```bash
docker run -d --name alpharay-test-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:17.6-alpine3.22
cd backend && .venv/bin/pytest                         # бэкенд на PostgreSQL
cd frontend && CHROMIUM_PATH=/usr/bin/chromium npm run e2e   # Playwright, сам поднимает бэкенд и vite
```
