# Third-party notices — frontend

Точные версии зафиксированы в `package-lock.json`.

## Runtime-зависимости

| Компонент | Лицензия | Назначение |
|---|---|---|
| react, react-dom 18 | MIT | UI |
| react-router-dom 6 | MIT | роутинг |
| @tanstack/react-query 5 | MIT | серверное состояние, поллинг статусов |
| react-hook-form 7 | MIT | формы |
| zod 3 | MIT | валидация |
| @hookform/resolvers | MIT | связка RHF + zod |
| lucide-react | ISC | иконки |
| @fontsource/manrope (шрифт Manrope) | SIL Open Font License 1.1 | шрифт интерфейса |

## Инструменты разработки и сборки

| Компонент | Лицензия |
|---|---|
| vite, @vitejs/plugin-react | MIT |
| typescript | Apache-2.0 |
| eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals | MIT |
| @playwright/test | Apache-2.0 |
| Docker-образы node:22-alpine, nginx:1.27-alpine | MIT / BSD-2-Clause (nginx) |

## Смоделированные интеграции (на бэкенде, `backend/app`)

Все данные синтетические. Реальные сервисы не вызываются.

- ЕГРЮЛ / ЕГРИП — регистрационные данные компании (`/company/lookup`, `enrichment.egrul`);
- ФНС «Прозрачный бизнес» — налоговая задолженность, блокировки, массовый адрес, задекларированная выручка (`enrichment.fns`);
- бюро кредитных историй — рейтинг, кредиты, просрочки (`enrichment.bki`);
- расчётный счёт клиента в банке — обороты, текущие кредиты, предварительный лимит (`/company/insights`);
- электронное подписание — квалифицированная электронная подпись руководителя: носитель с сертификатами УЦ ФНС России смоделирован на бэкенде, КриптоПро не вызывается; простая подпись — код подтверждения `4821`, показан на экране вместо SMS;
- выдача кредита — запись о смоделированной операции с номером `PAY-…`, реальный платёж не проводится;
- ИИ-ассистент — LLM с открытыми весами через OpenAI-совместимый API (по умолчанию Groq). Без ключа ассистент скрыт.
