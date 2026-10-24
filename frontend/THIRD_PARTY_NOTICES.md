# Third-party notices - frontend

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

## Смоделированные интеграции

Данные синтетические, реальные сервисы не вызываются: ЕГРЮЛ/ЕГРИП, ФНС, БКИ, расчётный счёт, подписание (КЭП и код `4821`), выдача кредита.

ИИ-ассистент - LLM с открытыми весами через OpenAI-совместимый API, без ключа скрыт.
