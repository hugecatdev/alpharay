# Фронтенд "Умного кредитного кабинета"

```bash
docker compose up --build # http://localhost:8080
```

## Структура

```
src/
  api/            client.ts (JWT, таймауты), types.ts, endpoints/*, queryKeys.ts
  app/            App, router, guards (роли), AppShell (Header, Sidebar, панель ассистента)
  features/
    auth/         LoginPage, AuthProvider
    dashboard/    главная: ЛК, лимит, заявки, долговая нагрузка, обороты
    application/  ApplicationWizard + steps/ + wizard/ (расчёты, риски, предоценка), ApplicationPage + details/, SignPage, список
    notifications/, company/ (профиль компании)
    assistant/    AssistantProvider (контекст экрана, сессия), AssistantPanel, AskButton, Markdown
    bank/         очередь, карточка заявки, скоринг, решения, статистика
  shared/         ui/ (кит), lib/ (money, dates, annuity, statusMeta, labels), hooks/
e2e/              Playwright-сценарии (против реального бэкенда)
```
