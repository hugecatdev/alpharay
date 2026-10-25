# Third-party notices

Точные версии зафиксированы в `frontend/package-lock.json`.

## Runtime-зависимости

- react, react-dom 18
- react-router-dom 6
- @tanstack/react-query 5
- react-hook-form 7
- zod 3
- @hookform/resolvers
- lucide-react
- @fontsource/manrope
- pdfmake, html-to-pdfmake
- Roboto

## Инструменты разработки и сборки

- vite, @vitejs/plugin-react
- typescript
- eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals
- @playwright/test
- Docker-образы node:22-alpine, nginx:1.27-alpine

## Смоделированные интеграции

Данные синтетические, реальные сервисы не вызываются: ЕГРЮЛ/ЕГРИП, ФНС, БКИ, расчётный счёт, подписание (КЭП и код `4821`), выдача кредита.

ИИ-ассистент — open-weight LLM через OpenAI-совместимый API.
