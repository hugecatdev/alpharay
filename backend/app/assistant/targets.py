SCREEN_TARGETS: dict[str, dict[str, str]] = {
    "dashboard": {
        "company-card": "карточка компании",
        "new-application": "кнопка «Нужно финансирование»",
        "loans": "долговая нагрузка и действующие кредиты",
        "turnover-chart": "график оборотов по счёту",
        "applications": "активные заявки",
    },
    "wizard.product": {
        "purpose": "выбор цели",
        "product-list": "список продуктов",
        "product-*": "карточка продукта, * — код продукта",
        "purpose-text": "поле «цель своими словами»",
    },
    "wizard.amount": {
        "amount": "ползунок суммы",
        "term": "ползунок срока",
        "payment-summary": "расчёт платежа",
        "overpayment": "переплата",
        "down-payment": "собственный аванс за оборудование",
        "term-compare": "сравнение сроков",
        "cashflow-fit": "впишется ли платёж в поток",
        "risk-warning": "блок «Кредит — это обязательство»",
        "precheck": "предварительная оценка",
    },
    "wizard.company": {
        "inn": "ИНН",
        "company-data": "данные из ЕГРЮЛ",
        "company-confirm": "галочка «Данные компании верны»",
    },
    "wizard.financials": {
        "revenue_12m": "выручка за 12 мес.",
        "revenue_last_3m": "выручка за последние 3 мес.",
        "expenses_12m": "расходы за 12 мес.",
        "net_profit_12m": "чистая прибыль",
        "monthly_debt_payments": "текущие платежи по кредитам",
        "employees_count": "число сотрудников",
        "tax_system": "система налогообложения",
    },
    "wizard.documents": {
        "documents-upload": "загрузка файлов",
        "documents-list": "загруженные документы",
        "doc-EQUIPMENT_INVOICE": "счёт на оборудование",
    },
    "wizard.review": {
        "summary": "сводка заявки",
        "consent-bki": "согласие на запрос в БКИ",
        "consent-personal": "согласие на обработку данных",
        "consent-risks": "подтверждение рисков",
        "submit": "кнопка «Отправить заявку»",
    },
    "application": {
        "status": "статус заявки",
        "timeline": "этапы рассмотрения",
        "action-block": "блок «Что требуется от вас»",
        "counter-offer": "сравнение запрошенных и предложенных условий",
        "info-request": "запрос информации от банка",
        "info-*": "поле запроса, * — код пункта",
        "decision-reasons": "причины решения",
        "schedule": "график платежей",
        "events": "история событий",
    },
    "sign": {
        "contract": "текст договора",
        "sign-confirm": "галочка «С условиями договора ознакомлен(а)»",
        "sign-code": "поле кода подтверждения",
    },
    "notifications": {"notifications-list": "список уведомлений"},
    "company": {"company-profile": "реквизиты компании", "company-loans": "действующие кредиты"},
    "onboarding": {"company-inn": "поле ИНН компании"},
}


def screen_targets(screen: str) -> dict[str, str]:
    return SCREEN_TARGETS.get(screen, {})


def describe_targets(screen: str) -> str:
    targets = screen_targets(screen)
    return "; ".join(f"{target} — {label}" for target, label in targets.items()) if targets else "нет"


def is_allowed_target(screen: str, target: str) -> bool:
    for allowed in screen_targets(screen):
        if allowed.endswith("*"):
            prefix = allowed[:-1]
            if target.startswith(prefix) and len(target) > len(prefix):
                return True
        elif allowed == target:
            return True
    return False
