from app.schemas import ApplicationStatus, InfoRequestItem

STATUS_META: dict[ApplicationStatus, tuple[str, str]] = {
    "DRAFT": (
        "Черновик",
        "Заявка ещё не отправлена. Данные сохраняются автоматически — можно вернуться в любой момент.",
    ),
    "SUBMITTED": ("Заявка отправлена", "Банк принял заявку и поставил её в очередь на автоматическую проверку."),
    "VALIDATING": ("Проверка данных", "Проверяем полноту и корректность данных заявки."),
    "ENRICHING": ("Запрос данных", "Запрашиваем ЕГРЮЛ, ФНС и бюро кредитных историй."),
    "SCORING": ("Оценка", "Оцениваем финансовое состояние бизнеса и платёжную дисциплину."),
    "DECIDING": ("Принятие решения", "Подбираем условия по результатам оценки."),
    "MANUAL_REVIEW": (
        "На рассмотрении у специалиста",
        "Заявку изучает кредитный специалист. Обычно это занимает до 1 рабочего дня.",
    ),
    "NEED_INFO": (
        "Нужна информация",
        "Банку не хватает данных для решения. Дополните заявку — рассмотрение продолжится автоматически.",
    ),
    "COUNTER_OFFER": (
        "Предложение на других условиях",
        "Банк готов выдать кредит, но на других условиях. Сравните и решите, подходит ли предложение.",
    ),
    "APPROVED": ("Одобрено", "Кредит одобрен. Проверьте условия и перейдите к подписанию договора."),
    "SIGNING": ("Подписание", "Договор сформирован. Подтвердите подписание кодом."),
    "SIGNED": ("Договор подписан", "Ожидайте зачисления средств на расчётный счёт."),
    "DISBURSED": ("Средства зачислены", "Деньги на расчётном счёте. График платежей доступен ниже."),
    "REJECTED": ("Отказ", "Банк не может выдать кредит на запрошенных условиях. Причины указаны ниже."),
    "CLIENT_DECLINED": (
        "Вы отклонили предложение",
        "Заявка закрыта по вашему решению. Можно подать новую в любой момент.",
    ),
    "CANCELLED": ("Отменена", "Заявка отменена."),
}

NEXT_STEP: dict[ApplicationStatus, str] = {
    "DRAFT": "Заполните оставшиеся шаги и отправьте заявку — черновик сохраняется автоматически.",
    "MANUAL_REVIEW": "Специалист изучит заявку, обычно до 1 рабочего дня. Если понадобятся документы, запрос появится в карточке заявки и в уведомлениях.",
    "NEED_INFO": "Ответьте на запрос банка в блоке «Что требуется от вас». После ответа проверка продолжится автоматически.",
    "COUNTER_OFFER": "Сравните запрошенные и предложенные условия и нажмите «Принять» или «Отклонить» — решение только за клиентом.",
    "APPROVED": "Проверьте условия и перейдите к подписанию договора.",
    "SIGNING": "Подтвердите подписание кодом на странице договора.",
    "SIGNED": "Договор подписан — деньги поступят на расчётный счёт в ближайшее время.",
    "DISBURSED": "Деньги на счёте. График платежей — в карточке заявки, держите сумму платежа на счёте заранее.",
    "REJECTED": "Причины указаны в карточке заявки. Можно подобрать другой продукт или подать заявку позже, устранив причины.",
    "CLIENT_DECLINED": "Заявка закрыта. Новую можно подать в любой момент.",
    "CANCELLED": "Заявка закрыта. Новую можно подать в любой момент.",
}

FUNNEL_STATUSES: tuple[ApplicationStatus, ...] = (
    "SUBMITTED",
    "VALIDATING",
    "ENRICHING",
    "SCORING",
    "DECIDING",
    "MANUAL_REVIEW",
    "NEED_INFO",
    "COUNTER_OFFER",
    "APPROVED",
    "SIGNING",
    "SIGNED",
    "DISBURSED",
    "REJECTED",
    "CLIENT_DECLINED",
    "CANCELLED",
)
PROCESSING_STATUSES: tuple[ApplicationStatus, ...] = ("SUBMITTED", "VALIDATING", "ENRICHING", "SCORING", "DECIDING")
AWAITING_CLIENT_STATUSES: tuple[ApplicationStatus, ...] = ("NEED_INFO", "COUNTER_OFFER", "APPROVED", "SIGNING")
APPROVED_STATUSES: tuple[ApplicationStatus, ...] = ("APPROVED", "SIGNING", "SIGNED", "DISBURSED")
FINAL_STATUSES: tuple[ApplicationStatus, ...] = ("SIGNED", "DISBURSED", "REJECTED", "CLIENT_DECLINED", "CANCELLED")
DECISION_STATUSES: tuple[ApplicationStatus, ...] = (
    "APPROVED",
    "COUNTER_OFFER",
    "NEED_INFO",
    "MANUAL_REVIEW",
    "REJECTED",
)

PROCESSING_NEXT_STEP = (
    "Ничего делать не нужно: статус обновляется автоматически, автоматическая проверка обычно занимает меньше минуты."
)

PURPOSE_LABELS = {
    "WORKING_CAPITAL": "Пополнение оборотных средств",
    "CASH_GAP": "Покрытие кассовых разрывов",
    "EQUIPMENT": "Покупка оборудования",
    "INVESTMENT": "Развитие и модернизация",
    "REAL_ESTATE": "Покупка помещения",
    "GOV_CONTRACT": "Исполнение госконтракта",
    "REFINANCING": "Рефинансирование кредитов",
}

PRODUCT_CATEGORY_LABELS = {
    "WORKING": "На текущие нужды",
    "INVESTMENT": "На развитие",
    "SPECIAL": "Специальные программы",
}

COLLATERAL_LABELS = {
    "NONE": "Без залога",
    "GUARANTEE": "Поручительство",
    "EQUIPMENT": "Залог оборудования",
    "PROPERTY": "Залог недвижимости",
    "CONTRACT": "Права по контракту",
}

TAX_SYSTEM_LABELS = {"USN_6": "УСН 6%", "USN_15": "УСН 15%", "OSN": "ОСН", "PATENT": "Патент"}

DOCUMENT_KIND_LABELS = {
    "BANK_STATEMENT": "Выписка по счёту",
    "TAX_RETURN": "Налоговая декларация",
    "EQUIPMENT_INVOICE": "Счёт на оборудование",
    "OTHER": "Другой документ",
}

REJECT_REASON_OPTIONS: dict[str, str] = {
    "OVERDUE": "Просроченная задолженность",
    "TAX_DEBT": "Налоговая задолженность",
    "LOW_REVENUE": "Недостаточная выручка",
    "HIGH_DEBT_LOAD": "Высокая долговая нагрузка",
    "STOP_FACTORS": "Стоп-факторы по внешним источникам",
    "DATA_MISMATCH": "Существенное расхождение данных",
    "OTHER": "Другое",
}

INFO_REQUEST_OPTIONS: dict[str, InfoRequestItem] = {
    item.code: item
    for item in [
        InfoRequestItem(code="revenue_12m", label="Уточните выручку за 12 месяцев", type="number"),
        InfoRequestItem(code="statement_6m", label="Выписка по счёту за 6 месяцев", type="document"),
        InfoRequestItem(code="tax_return", label="Налоговая декларация за последний период", type="document"),
        InfoRequestItem(code="equipment_invoice", label="Счёт на оборудование", type="document"),
        InfoRequestItem(code="overdue_explanation", label="Пояснение по просрочке", type="text"),
    ]
}

RISK_LEVEL_LABELS = {"low": "низкий", "medium": "средний", "high": "высокий"}

PRECHECK_LABELS = {"ok": "высокая", "warn": "средняя", "bad": "низкая"}

FIELD_LABELS = {
    "revenue_12m": "выручка за 12 месяцев",
    "revenue_last_3m": "выручка за последние 3 месяца",
    "expenses_12m": "расходы за 12 месяцев",
    "net_profit_12m": "чистая прибыль",
    "monthly_debt_payments": "текущие платежи по кредитам",
    "employees_count": "число сотрудников",
    "tax_system": "система налогообложения",
    "monthly_payment": "ежемесячный платёж",
    "total_payment": "всего к возврату",
    "payment_share_of_cashflow": "доля платежа в чистом потоке",
    "debt_load_percent": "нагрузка: все платежи по кредитам к денежному потоку",
    "revenue_drop_reserve_percent": "запас прочности по выручке",
    "existing_monthly_payments": "платежи по текущим кредитам",
    "risk_level": "уровень риска",
    "precheck_level": "предварительная оценка",
    "statement_6m": "выписка по счёту за 6 месяцев",
    "tax_return": "налоговая декларация",
    "equipment_invoice": "счёт на оборудование",
    "overdue_explanation": "пояснение по просрочке",
}

MISSING_LABELS = {
    "product": "кредитный продукт",
    "product_eligibility": "продукт доступен только приоритетным отраслям",
    "amount": "сумма в пределах продукта",
    "term": "срок в пределах продукта",
    "company_confirmed": "подтверждение данных компании",
    "financials": "финансовые показатели",
    "equipment_invoice": "счёт на оборудование",
    "consent_bki": "согласие на запрос в бюро кредитных историй",
    "consent_personal_data": "согласие на обработку персональных данных",
    "consent_risks": "подтверждение ознакомления с рисками",
}


def status_title(status: ApplicationStatus) -> str:
    return STATUS_META[status][0]


def status_description(status: ApplicationStatus) -> str:
    return STATUS_META[status][1]


def next_step(status: ApplicationStatus) -> str:
    return NEXT_STEP.get(status, PROCESSING_NEXT_STEP)
