# AlphaRay — умный кредитный кабинет

Прототип цифрового кредитного конвейера для малого бизнеса: кабинет предпринимателя, кабинет андеррайтера и ИИ-ассистент Рэй.

- `frontend/` — React + Vite, nginx в Docker ([README](frontend/README.md), тестовые учётки — [DEMO_ACCOUNTS.txt](frontend/DEMO_ACCOUNTS.txt));
- `backend/` — FastAPI: конвейер, скоринг, обогащение, договор, кабинет андеррайтера, администрирование банка (кредитная политика, продукты, сотрудники, распределение, аудит), ассистент ([README](backend/README.md));
- [`docs/architecture.md`](docs/architecture.md) — архитектура: контекст, контейнеры, компоненты, сквозной кредитный путь, ассистент, безопасность и надёжность, путь к промышленной версии;
- `docs/api/openapi.json` — схема API, `docs/prompts/` — исходное ТЗ.

## Запуск в Docker

```bash
cp backend/.env.example backend/.env    # по желанию: ключ LLM для Рэя
docker compose up --build               # http://localhost:8080, пароль у всех учёток — demo
```

Данные хранятся в томе `backend-data`; сбросить демо — `docker compose down -v`.

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
