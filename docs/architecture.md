# Архитектура AlphaRay

AlphaRay — прототип цифрового кредитного конвейера для малого и микробизнеса. Один продукт объединяет три роли: предприниматель подаёт заявку и проходит путь до выдачи, андеррайтер разбирает нестандартные заявки, руководитель кредитного управления настраивает политику, продукты и распределение работы. Заявка проходит по единому конвейеру; данные и состояние хранятся в PostgreSQL, этапы выполняет воркер, фронтенд только отображает результат.

Схемы ниже — Mermaid, GitHub рисует их прямо на странице.

## 1. Контекст системы

```mermaid
flowchart LR
    client["Предприниматель<br/>собственник, директор, бухгалтер"]
    underwriter["Андеррайтер<br/>кредитный аналитик"]
    head["Руководитель<br/>кредитного управления"]

    subgraph alpharay["AlphaRay — кредитный конвейер"]
        web["Веб-кабинеты<br/>клиента и банка"]
        api["API и воркер<br/>конвейер, проверки, скоринг, кредитные правила"]
        db[("PostgreSQL")]
        mocks["Смоделированные интеграции<br/>ЕГРЮЛ/ЕГРИП · ФНС · БКИ<br/>расчётный счёт · подписание · выдача"]
    end

    llm["LLM-провайдер<br/>OpenAI-совместимый API<br/>модель с открытыми весами"]

    client --> web
    underwriter --> web
    head --> web
    web -->|"REST /api, JWT"| api
    api --> db
    api --> mocks
    api -.->|"только ассистент Рэй, по желанию"| llm
```

- Весь сценарий проходит внутри продукта: без почты, SMS и мессенджеров. Уведомления, запросы банка, предложения и подписание — в кабинете.
- Внешние источники смоделированы с сохранением смысла интеграции: данные ЕГРЮЛ/ФНС/БКИ и обороты по счёту — синтетические таблицы, к которым ходит заменяемый шлюз `SourceGateway`; подписание — КЭП руководителя на смоделированном носителе или код на экране; выдача — запись об операции. Интерфейс и договор явно помечают подписание и выдачу как смоделированные.
- LLM нужна только ассистенту. Без ключа Рэй скрыт, основной сценарий от него не зависит, платные ресурсы для проверки не требуются.

## 2. Контейнеры и развёртывание

```mermaid
flowchart LR
    browser["Браузер<br/>React SPA"]

    subgraph host["docker compose — один хост"]
        subgraph fe["frontend · nginx 1.27"]
            static["Статика SPA<br/>SPA fallback, gzip, кеш /assets"]
            proxy["Прокси /api/ → API_UPSTREAM"]
        end
        api["backend · FastAPI :8000<br/>non-root, healthcheck /api/health/ready"]
        worker["worker · python -m app.worker<br/>тот же образ"]
        pg[("postgres 17.6<br/>том postgres-data")]
        files[("том backend-data<br/>/data/uploads")]
        ollama["ollama 0.40.5<br/>профиль ollama, по желанию"]
    end

    cloud["Внешний LLM-провайдер<br/>Groq, vLLM, cloud.ru и др."]

    browser -->|"HTTP :8080"| static
    browser -->|"HTTP :8080/api"| proxy
    proxy -->|"http://backend:8000"| api
    api --> pg
    worker --> pg
    api --> files
    api -.->|"HTTPS /chat/completions"| cloud
    api -.->|"http://ollama:11434/v1"| ollama
```

| Контейнер | Образ и сборка | Порт | Данные | Проверка и перезапуск |
|---|---|---|---|---|
| `postgres` | `postgres:17.6-alpine3.22`, закреплён по digest | `5432`, только внутри сети compose | том `postgres-data` | `pg_isready`, `restart: unless-stopped` |
| `backend` | `python:3.13-slim`, зависимости из `poetry.lock` с проверкой хешей, миграции в образе | `8000`, внутри сети | том `backend-data` → `/data/uploads` | `GET /api/health/ready`, стартует после `postgres: healthy` |
| `worker` | тот же образ, `python -m app.worker` | — | — | `restart: unless-stopped`, стартует после `postgres: healthy` |
| `frontend` | multi-stage: `node:22-alpine` собирает Vite, `nginx:1.27-alpine` отдаёт статику | `8080 → 80` | — | `wget /`, стартует после `backend: healthy` |
| `ollama` + `ollama-pull` | `ollama/ollama:0.40.5`, профиль `ollama` | `11434`, внутри сети | том `ollama-models` | скачивает модель `OLLAMA_MODEL` при первом запуске |

Запуск одной командой: `docker compose up --build` из корня. Конфигурация бэкенда — `backend/.env` (шаблон `backend/.env.example`), строка подключения к БД задаётся в `docker-compose.yml`, версии зафиксированы в `backend/poetry.lock` и `frontend/package-lock.json`. API и воркер при старте применяют миграции и загружают демо-данные в пустую базу под advisory-блокировкой, поэтому их можно запускать в любом порядке и количестве.

## 3. Бэкенд

```mermaid
flowchart TB
    subgraph http["HTTP-слой · app/routers"]
        direction LR
        r_client["Клиент<br/>auth · config · company<br/>applications · notifications"]
        r_bank["Андеррайтер<br/>bank"]
        r_admin["Руководитель<br/>admin"]
        r_ai["Ассистент<br/>assistant"]
        r_client ~~~ r_bank ~~~ r_admin ~~~ r_ai
    end

    deps["deps.py · idempotency.py · ratelimit.py · logs.py · errors.py<br/>транзакция на запрос, JWT и роли, Idempotency-Key,<br/>лимиты, X-Request-ID, формат ошибок"]

    subgraph domain["Предметная логика"]
        direction LR
        pipeline["pipeline.py<br/>переходы, этапы, предложения,<br/>подписание, выдача"]
        decision["decision.py<br/>кредитные правила, рекомендация"]
        scoring["scoring.py<br/>скоринг, стоп-факторы"]
        integrations["integrations.py<br/>шлюз источников, проверки"]
        insights["insights.py<br/>обороты, нагрузка, лимит"]
        documents["annuity.py · contract.py · signature.py<br/>график, договор, КЭП"]
        pipeline --> decision --> scoring
        pipeline --> integrations
        insights ~~~ documents
    end

    worker["worker.py<br/>FOR UPDATE SKIP LOCKED,<br/>повторы с задержкой"]

    subgraph assistant["app/assistant"]
        direction LR
        agent["agent.py<br/>раунды tool calling"]
        tools["tools.py<br/>инструменты"]
        prompt["prompt.py<br/>контекст и расчёты"]
        llmc["llm.py<br/>OpenAI-совместимый клиент"]
        agent --> tools
        agent --> prompt
        agent --> llmc
    end

    repo["repo.py · models.py · db.py<br/>запросы, ORM SQLAlchemy, типы столбцов"]
    boot["bootstrap.py · seeds.py · migrations/<br/>Alembic, посев, сброс демо"]
    pg[("PostgreSQL")]
    llm["LLM-провайдер"]

    http --> deps
    deps --> domain
    deps --> assistant
    assistant -->|"короткие транзакции"| domain
    worker --> pipeline
    domain --> repo
    boot --> repo
    repo --> pg
    llmc -.-> llm
```

| Модуль | Ответственность |
|---|---|
| `app/routers/*` | REST API под `/api`: клиент (`auth`, `config`, `company`, `applications`, `notifications`), андеррайтер (`bank`), руководитель (`admin`), ассистент (`assistant`), служебное (`health/live`, `health/ready`, `demo/reset`) |
| `app/deps.py`, `app/security.py` | транзакция на запрос (commit до отправки ответа), разбор JWT, роль и активность учётки, доступ клиента только к заявкам своей компании |
| `app/idempotency.py`, `app/ratelimit.py`, `app/logs.py`, `app/errors.py` | `Idempotency-Key` с сохранёнными ответами, лимиты частоты, JSON-логи и `X-Request-ID`, единый формат ошибок |
| `app/pipeline.py` | таблица переходов статусов, события и уведомления, этапы конвейера, ревизии анкеты, решения (авто и ручные), предложения и их истечение, принятие условий, подписание, выдача, автораспределение |
| `app/decision.py` | кредитные правила с кодами причин и рекомендация андеррайтеру; отдельно от скоринга |
| `app/scoring.py` | скоринг по 7 факторам (возраст бизнеса, выручка к сумме, платежи к выручке, платёжная дисциплина, рейтинг БКИ, динамика выручки, рентабельность), стоп-факторы, расхождения с ФНС |
| `app/integrations.py` | шлюз `SourceGateway` к ЕГРЮЛ/ЕГРИП, ФНС, БКИ и счетам в банке; синтетическая реализация с режимами сбоя; результат каждой проверки — `OK`, `ISSUES` или `ERROR` |
| `app/insights.py` | обороты по счёту, чистый денежный поток, долговая нагрузка, предварительный лимит, действующие кредиты, отчёт БКИ с собственными кредитами банка, предзаполнение финансов |
| `app/annuity.py`, `app/contract.py`, `app/signature.py` | аннуитетный платёж, график, HTML договора, сертификаты КЭП на смоделированном носителе руководителя |
| `app/worker.py` | очередь шагов: выбор созревших заявок `FOR UPDATE SKIP LOCKED`, шаг в savepoint, при сбое — задержка до минуты; поток внутри API или отдельный процесс |
| `app/models.py`, `app/repo.py`, `app/db.py` | ORM-модели SQLAlchemy 2.1, фасад запросов `Db`, типы столбцов: время в миллисекундах поверх `timestamptz`, pydantic-снимки поверх `JSONB` |
| `app/bootstrap.py`, `app/seeds.py`, `migrations/` | миграции Alembic и посев под advisory-блокировкой, синтетические данные, сброс демо (`python -m app.cli reset-demo`) |
| `app/assistant/*` | ассистент Рэй — раздел 7 |

### Воркер конвейера

У заявки в работе есть `next_run_at` — время следующего шага. Воркер раз в полсекунды берёт созревшие заявки по одной в транзакции: `SELECT … FOR UPDATE SKIP LOCKED`. Команды клиента и банка блокируют ту же строку `SELECT … FOR UPDATE`, поэтому отзыв во время работы конвейера даёт один согласованный исход, а несколько воркеров не обрабатывают одну заявку дважды. Время перехода считается от входа в этап, а не от момента обработки: после простоя воркера история событий такая же, как при непрерывной работе. Упавший шаг откатывается до savepoint, заявка откладывается с экспоненциальной задержкой. Тесты управляют часами и вызывают воркер явно — весь путь проверяется без ожидания.

## 4. Статусы и переходы

Диаграмма повторяет таблицу `TRANSITIONS` в `backend/app/pipeline.py`; любой другой переход сервер отклоняет (`409 INVALID_TRANSITION`). Из всех состояний до подписания клиент может отозвать заявку — `CANCELLED`, на схеме эти стрелки опущены.

```mermaid
stateDiagram-v2
    [*] --> DRAFT: клиент создал черновик
    DRAFT --> SUBMITTED: клиент отправил, ревизия 1
    SUBMITTED --> VALIDATING: воркер
    VALIDATING --> ENRICHING: анкета полная
    ENRICHING --> ENRICHING: БКИ не ответило, повтор
    ENRICHING --> SCORING: ЕГРЮЛ, ФНС, БКИ, счёт получены
    ENRICHING --> MANUAL_REVIEW: БКИ недоступно после 3 попыток
    SCORING --> DECIDING: оценка риска
    DECIDING --> APPROVED: правила — одобрение
    DECIDING --> COUNTER_OFFER: нагрузка выше предела
    DECIDING --> NEED_INFO: выручка расходится с ФНС
    DECIDING --> MANUAL_REVIEW: порог суммы, просрочка, грейд C
    DECIDING --> REJECTED: стоп-факторы, грейд D
    MANUAL_REVIEW --> APPROVED: андеррайтер
    MANUAL_REVIEW --> COUNTER_OFFER: андеррайтер
    MANUAL_REVIEW --> NEED_INFO: андеррайтер
    MANUAL_REVIEW --> REJECTED: андеррайтер
    NEED_INFO --> SUBMITTED: клиент ответил, новая ревизия
    APPROVED --> OFFER_ACCEPTED: клиент принял условия
    COUNTER_OFFER --> OFFER_ACCEPTED: клиент принял условия
    APPROVED --> CLIENT_DECLINED: клиент отклонил
    COUNTER_OFFER --> CLIENT_DECLINED: клиент отклонил
    APPROVED --> EXPIRED: срок предложения истёк
    COUNTER_OFFER --> EXPIRED: срок предложения истёк
    OFFER_ACCEPTED --> SIGNING: договор на подпись
    SIGNING --> SIGNED: КЭП или код
    SIGNED --> DISBURSED: смоделированная выдача
    DISBURSED --> [*]
    REJECTED --> [*]
    CLIENT_DECLINED --> [*]
    EXPIRED --> [*]
```

Повторная подача после отказа, отклонения, отзыва или истечения создаёт новую заявку со ссылкой на прежнюю; конечные статусы не переписываются.

## 5. Фронтенд

```mermaid
flowchart LR
    router["React Router<br/>защита маршрутов по роли"]

    subgraph client["/app — роль CLIENT"]
        dash["Главная, компания,<br/>онбординг без компании"]
        wizard["Мастер заявки, 6 шагов<br/>мгновенные расчёты платежа"]
        details["Заявка: принятие условий,<br/>подписание, повторная подача"]
        ray["Панель Рэя<br/>подсветка, подстановка в форму"]
    end

    subgraph bank["/bank — роли UNDERWRITER и ADMIN"]
        queue["Очередь, карточка заявки:<br/>проверки, версии анкеты,<br/>скоринг, решения, статистика"]
    end

    apiLayer["src/api<br/>client.ts: JWT, 401 → выход, таймауты,<br/>Idempotency-Key, If-Match<br/>endpoints/*, types.ts — контракт"]
    query["TanStack Query<br/>кеш и опрос статусов"]

    router --> client
    router --> bank
    dash --> query
    wizard --> query
    details --> query
    ray --> apiLayer
    queue --> query
    query --> apiLayer
    apiLayer -->|"fetch /api"| backend["Бэкенд"]
```

- Всё общение с бэкендом — через `src/api`: остальное приложение не знает про HTTP. Типы в `src/api/types.ts` зеркалят `backend/app/schemas.py` и схему `docs/api/openapi.json`.
- Каждая команда уходит с новым `Idempotency-Key`; при обрыве сети клиент повторяет запрос с тем же ключом. Сохранение черновика передаёт `If-Match` с версией заявки.
- Статусы обновляются опросом: карточка заявки в обработке — каждые 2 с, подписание — 1 с, очередь андеррайтера — 5 с, список заявок в обработке — 5 с, уведомления и главная — 10 с.
- На клиенте остались только мгновенные расчёты интерфейса: платёж при движении ползунков, «впишется ли платёж», предоценка. Решение, скоринг, договор и график считает бэкенд.

## 6. Сквозной кредитный путь

```mermaid
sequenceDiagram
    autonumber
    actor C as Предприниматель
    participant FE as Кабинет клиента
    participant API as API
    participant W as Воркер
    participant SRC as Источники (моки)
    actor U as Андеррайтер

    C->>FE: Цель, продукт, сумма и срок, компания, финансы, документы, согласия
    FE->>API: POST /applications, PATCH с If-Match на каждом шаге
    C->>FE: «Отправить заявку»
    FE->>API: POST /applications/:id/submit, Idempotency-Key
    API->>API: Проверка полноты, иначе 422 и список недостающего
    API-->>FE: SUBMITTED, ревизия 1
    loop Каждые 2 с
        W->>W: VALIDATING → ENRICHING → SCORING → DECIDING
        W->>SRC: ЕГРЮЛ, ФНС, счёт, БКИ (повтор при сбое)
        W->>W: Скоринг, затем кредитные правила
    end
    FE->>API: GET /applications/:id — опрос
    alt Авторешение
        API-->>FE: APPROVED, COUNTER_OFFER, NEED_INFO или REJECTED
    else Ручное рассмотрение
        API-->>FE: MANUAL_REVIEW
        U->>API: POST /bank/applications/:id/decision
        API-->>FE: Решение специалиста и уведомление
    end
    opt Нужна информация
        C->>FE: Ответ на запрос банка и документы
        FE->>API: POST /applications/:id/info-requests/:rid/respond
        API->>API: Новая ревизия, повторный прогон конвейера
    end
    C->>FE: «Принять условия»
    FE->>API: POST /offer/accept { offer_id }
    API-->>FE: OFFER_ACCEPTED, договор сформирован
    C->>FE: Подписание КЭП руководителя или кодом с экрана
    FE->>API: POST sign, затем sign/kep или sign/confirm
    API-->>FE: SIGNED
    alt Автовыдача по политике
        W->>W: DISBURSED через 3 с, операция PAY-…
    else Выдача подтверждается банком
        U->>API: POST /bank/applications/:id/disburse
    end
    API-->>FE: DISBURSED, график платежей
```

Каждый переход пишет событие в историю заявки с `correlation_id`, этапы и решения создают уведомления клиенту, действия сотрудников банка попадают в журнал аудита. Исходы для любых компаний, включая демо, решают кредитные правила (`backend/README.md`, раздел «Кредитные правила»).

## 7. Ассистент Рэй

```mermaid
sequenceDiagram
    autonumber
    actor C as Предприниматель
    participant P as Панель Рэя
    participant API as POST /api/assistant/chat
    participant DB as PostgreSQL
    participant LLM as LLM, OpenAI-совместимый API

    C->>P: Вопрос или «поставь 2 млн на 36 месяцев»
    P->>API: Сообщение и контекст экрана: screen, data, application_id
    API->>DB: Короткая транзакция: история, сводка компании и заявки
    API->>API: Системный промпт: расчёт по экрану и варианты считает сервер
    loop Раунды, не больше LLM_MAX_ROUNDS
        API->>LLM: /chat/completions с инструментами
        LLM-->>API: tool_calls
        API->>DB: Инструменты данных, каждый — своя короткая транзакция
        API->>API: show_hints и fill_loan_form — проверка целей и лимитов продукта
    end
    LLM-->>API: Текст ответа
    API->>API: Убрать служебные коды и продублированные вопросы
    API->>DB: Сохранить сообщения диалога
    API-->>P: content, hints, suggestions, actions
    P->>C: Ответ, подсветка элементов, подстановка суммы и срока в форму
    Note over API,LLM: Нет ключа — Рэй скрыт. Ошибка или таймаут — 503, «Ассистент временно недоступен»
```

- Провайдер меняется переменными `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; используются только модели с открытыми весами (по умолчанию `openai/gpt-oss-120b` у Groq).
- Цифры считает сервер, а не модель: платёж, переплата, доля в потоке, варианты условий и лимит приходят в промпт готовыми.
- Рэй объясняет и умеет одно действие — по просьбе клиента подставить сумму и срок в форму. Подсказки и действия проверяются на сервере: цели подсветки — по списку текущего экрана, сумма и срок — по границам продукта.
- Пока модель думает, соединение с БД не держится: инструменты открывают короткие транзакции, остальные запросы не ждут ассистента.

## 8. Данные

PostgreSQL 17, ORM — SQLAlchemy 2.1, драйвер psycopg 3, схема — миграции Alembic (`backend/migrations`). Время — `timestamptz` в UTC, деньги — целые рубли `BIGINT`, ставки — `NUMERIC`, снимки продукта, компании и финансов — `JSONB`, перечисления — `CHECK`-ограничения.

```mermaid
erDiagram
    companies ||--o{ users : "представители"
    companies ||--|| company_sources : "ЕГРЮЛ, ФНС, БКИ"
    companies ||--o{ account_turnover : "обороты"
    companies ||--o{ external_loans : "кредиты в других банках"
    companies ||--o{ applications : "заявки"
    products ||--o{ applications : "продукт"
    applications ||--o{ application_revisions : "снимки анкеты"
    applications ||--o{ application_documents : "документы"
    application_revisions ||--o{ check_results : "проверки"
    application_revisions ||--o{ risk_assessments : "оценка риска"
    applications ||--o{ credit_decisions : "решения"
    credit_decisions ||--o{ info_requests : "запросы информации"
    credit_decisions ||--o{ offers : "версии предложений"
    offers ||--o| contracts : "договор"
    offers ||--o| disbursements : "выдача"
    applications ||--o{ application_events : "история"
    applications ||--o{ notifications : "уведомления"
    applications ||--o{ application_notes : "заметки банка"
    users ||--o{ assistant_sessions : "диалоги"
    users ||--o{ idempotency_keys : "ключи команд"
```

- Отправка и каждый ответ на запрос банка создают неизменяемую ревизию анкеты; проверки, оценка риска и решение ссылаются на ревизию, решение — ещё и на версию кредитной политики.
- Уникальные ограничения: номер заявки, версия предложения внутри заявки, одна выдача на заявку, номер операции выдачи, ключ идемпотентности на пользователя.
- Индексы — по компании и времени изменения, статусу, исполнителю, `next_run_at` очереди (частичный), истории заявки и журналу аудита.
- Загруженные файлы — в томе `backend-data` (`/data/uploads/<заявка>/<документ>`), в БД — метаданные, тип и SHA-256.
- Демо-данные загружаются один раз в пустую базу; обычный перезапуск их не трогает, сброс — явная команда `python -m app.cli reset-demo` или `docker compose down -v`.

## 9. Безопасность и надёжность

| Область | Как устроено |
|---|---|
| Аутентификация | JWT HS256 со сроком 12 ч, секрет — `JWT_SECRET` из окружения; пароли — PBKDF2-SHA256, 120 000 итераций |
| Авторизация | роли `CLIENT`, `UNDERWRITER`, `ADMIN` на каждом эндпоинте; клиент видит только заявки своей компании; инструменты Рэя читают данные только своей компании; заблокированный сотрудник получает 403 при входе и 401 на старый токен |
| Целостность | транзакция на запрос, commit до ответа; блокировка строки заявки на командах; таблица переходов; уникальные ограничения на выдачу и версии предложений; `Idempotency-Key` на командах; `If-Match` на черновике; принятие предложения сверяет его версию |
| Аудит | журнал действий банка с автором, ролью, временем и `correlation_id`: решения, назначения, заметки, выдачи, изменения продуктов, политики и сотрудников; история заявки — с инициатором и причиной каждого перехода |
| Секреты и контейнеры | `.env` не попадает в репозиторий и образы; бэкенд работает не от root; пароль БД задаётся окружением; лимит загрузки 20 МБ в nginx и на бэкенде |
| Недоверенный контент | договор собирается на сервере с экранированием и показывается в iframe с `sandbox`; ответ LLM очищается от служебных кодов, подсказки и действия валидируются |
| Внешние сервисы | сбой БКИ — до 3 попыток, затем ручное рассмотрение с кодом `INTEGRATION_ERROR`, а не отказ; LLM изолирована таймаутами (соединение 4 с, запрос 12 с, ответ целиком 18 с) и повторами при 429/5xx, при сбое — 503 без влияния на остальной сценарий |
| Нагрузка | лимиты частоты на вход, ассистента, загрузку файлов и команды; пул соединений БД; списки читаются выборками с подгрузкой связей |
| Наблюдаемость | JSON-логи с `correlation_id`; `X-Request-ID` в ответе и в теле ошибки; `GET /api/health/live` и `/api/health/ready` (БД, версия схемы, отставание очереди конвейера, статус ассистента) |
| Отказоустойчивость | healthcheck и автоперезапуск контейнеров; фронтенд стартует после готовности бэкенда, бэкенд и воркер — после готовности БД; состояние переживает перезапуск; задания конвейера хранятся в БД и продолжаются после падения воркера |
| Проверки | pytest на PostgreSQL — сценарии клиента, андеррайтера, администратора, агента на фейковой LLM и надёжности; Playwright — сквозные сценарии против реального бэкенда |

## 10. Ограничения прототипа и путь к промышленной версии

| Сейчас | Промышленно |
|---|---|
| Очередь конвейера — `next_run_at` в таблице заявок, воркер на `SKIP LOCKED` | брокер (Kafka или RabbitMQ) с outbox и идемпотентными обработчиками; оркестрация процесса — BPM-движок (Camunda, Temporal) |
| Синтетические ЕГРЮЛ, ФНС, БКИ и счета за шлюзом `SourceGateway` | адаптеры к реальным источникам за тем же интерфейсом, кеширование ответов, circuit breaker |
| Лимиты частоты в памяти процесса | общий счётчик в Redis для нескольких экземпляров API |
| Собственный JWT | единый вход банка через OIDC (Keycloak), mTLS между сервисами |
| Файлы в томе | S3-совместимое хранилище с антивирусной проверкой |
| Один экземпляр PostgreSQL | реплики, резервные копии с проверкой восстановления, PgBouncer |
| Логи в stdout | OpenTelemetry: трассировки, метрики конвейера и SLA, алерты |
| Сертификаты КЭП смоделированы на бэкенде | подпись в браузере через КриптоПро ЭЦП Browser plug-in (откреплённая CMS по ГОСТ Р 34.10-2012), проверка подписи, цепочки до УЦ ФНС и списков отзыва на сервере, полномочий — по ЕГРЮЛ или МЧД |
| LLM у внешнего провайдера | vLLM с моделью с открытыми весами внутри периметра банка — меняется только `LLM_BASE_URL` |

## 11. Технологии

| Слой | Технологии (версии из lock-файлов) |
|---|---|
| Бэкенд | Python 3.13, FastAPI 0.157, Starlette 1.9, Pydantic 2.14, pydantic-settings 2.16, SQLAlchemy 2.1, psycopg 3.3, Alembic 1.20, Uvicorn 0.54, PyJWT 2.15, httpx 0.28, Poetry 2.5 |
| База данных | PostgreSQL 17.6 |
| Фронтенд | React 18.3, React Router 6.30, TanStack Query 5.104, react-hook-form 7.90, zod 3.25, TypeScript 5.8, Vite 6.4 |
| Инфраструктура | Docker, docker compose, nginx 1.27, Node 22 для сборки, Ollama 0.40.5 по желанию |
| Качество | pytest 9.1, Ruff 0.17, ESLint 9, Playwright 1.64 |

Описание API — `docs/api/openapi.json` и Swagger UI на `/api/docs`; запуск и переменные окружения — `README.md`, `backend/README.md`, `frontend/README.md`.
