# Third-party notices

Точные версии зафиксированы в `frontend/package-lock.json`.

## Runtime-зависимости

| Компонент | Назначение |
|---|---|
| react, react-dom 18 | UI |
| react-router-dom 6 | роутинг |
| @tanstack/react-query 5 | серверное состояние, поллинг статусов |
| react-hook-form 7 | формы |
| zod 3 | валидация |
| @hookform/resolvers | связка RHF + zod |
| lucide-react | иконки |
| @fontsource/manrope | шрифт интерфейса |
| pdfmake, html-to-pdfmake | PDF кредитного договора |
| Roboto | шрифт PDF с кириллицей |

## Инструменты разработки и сборки

- vite, @vitejs/plugin-react
- typescript
- eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals
- @playwright/test
- Docker-образы node:22-alpine, nginx:1.27-alpine

## Смоделированные интеграции

Данные синтетические, реальные сервисы не вызываются: ЕГРЮЛ/ЕГРИП, ФНС, БКИ, расчётный счёт, подписание (КЭП и код `4821`), выдача кредита.

ИИ-ассистент — open-weight LLM через OpenAI-совместимый API.
