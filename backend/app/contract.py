from app.annuity import build_schedule, credit_summary
from app.fmt import date_ru, escape_html, money, parse_ms, percent, rate_text
from app.labels import COLLATERAL_LABELS
from app.models import StoredApplication


def loan_terms(record: StoredApplication) -> tuple[int, int, float]:
    app = record.app
    if app.offer:
        return app.offer.amount, app.offer.term, app.offer.rate
    return app.amount, app.term, app.product.base_rate


def schedule_start(record: StoredApplication, now: int) -> int:
    return parse_ms(record.disbursed_at) if record.disbursed_at else now


def security_rows(record: StoredApplication, amount: int) -> str:
    product = record.app.product
    rows = ""
    if product.collateral != "NONE":
        subject = "приобретаемое оборудование" if product.collateral == "EQUIPMENT" else COLLATERAL_LABELS[product.collateral].lower()
        rows += f"<tr><th>Обеспечение</th><td>{escape_html(subject)}</td></tr>"
    if product.down_payment_share > 0:
        share = product.down_payment_share
        cost = round(amount / (1 - share))
        rows += (
            f"<tr><th>Собственный аванс Заёмщика</th><td>не менее {percent(share * 100)} стоимости — "
            f"от {money(cost - amount)} при стоимости {money(cost)}</td></tr>"
        )
    return rows


def revolving_html(record: StoredApplication, amount: int, term: int, rate: float) -> str:
    interest = credit_summary("REVOLVING", amount, term, rate).monthly_payment
    return f"""<h3>2. Предмет договора</h3>
<p>Кредитор устанавливает лимит овердрафта к расчётному счёту Заёмщика «{escape_html(record.app.product.name)}»:</p>
<table>
<tbody>
<tr><th>Лимит овердрафта</th><td>{money(amount)}</td></tr>
<tr><th>Срок действия лимита</th><td>{term} мес.</td></tr>
<tr><th>Процентная ставка</th><td>{rate_text(rate)} годовых на фактическую задолженность</td></tr>
<tr><th>Проценты в месяц при полном использовании лимита</th><td>{money(interest)}</td></tr>
<tr><th>Цель</th><td>{escape_html(record.app.purpose or "Не указана")}</td></tr>
</tbody>
</table>
<h3>3. Порядок погашения</h3>
<p>Поступления на расчётный счёт автоматически погашают задолженность. Каждый транш погашается не позднее 60 календарных дней с даты его предоставления. Проценты начисляются ежедневно на фактическую задолженность и уплачиваются ежемесячно. Если лимит не используется, проценты не начисляются. Графика аннуитетных платежей нет.</p>"""


def contract_html(record: StoredApplication, now: int) -> str:
    app = record.app
    amount, term, rate = loan_terms(record)
    company = app.company
    revolving = app.product.repayment == "REVOLVING"
    number = app.contract.number if app.contract else f"ДК-{app.number.replace('КР-', '')}"
    signed_at = app.contract.signed_at if app.contract else None
    signed = f'<p class="signed">Подписан простой электронной подписью {date_ru(signed_at)}.</p>' if signed_at else ""
    title = "Договор об овердрафтном кредитовании" if revolving else "Кредитный договор"
    parties = f"""<h2>{title} № {escape_html(number)}</h2>
<p class="meta">г. Москва · {date_ru(signed_at or now)}</p>
<h3>1. Стороны</h3>
<p><strong>Кредитор:</strong> Банк (демонстрационный стенд AlphaRay).</p>
<p><strong>Заёмщик:</strong> {escape_html(company.name)}, ИНН {escape_html(company.inn)}, ОГРН {escape_html(company.ogrn)}, адрес: {escape_html(company.address)}, в лице {escape_html(company.head_name)}.</p>"""
    if revolving:
        return f"""<article class="contract">
{parties}
{revolving_html(record, amount, term, rate)}
{liability_html(revolving=True)}
{signed}
<p class="note">Документ сформирован в демонстрационном режиме и не является офертой.</p>
</article>"""

    summary = credit_summary("ANNUITY", amount, term, rate)
    schedule = build_schedule(amount, term, rate, schedule_start(record, now))
    first_rows = "".join(
        f"<tr><td>{index}</td><td>{date_ru(row.date)}</td><td>{money(row.amount)}</td>"
        f"<td>{money(row.principal)}</td><td>{money(row.interest)}</td><td>{money(row.balance)}</td></tr>"
        for index, row in enumerate(schedule[:3], start=1)
    )

    return f"""<article class="contract">
{parties}
<h3>2. Предмет договора</h3>
<p>Кредитор предоставляет Заёмщику кредит «{escape_html(app.product.name)}» на следующих условиях:</p>
<table>
<tbody>
<tr><th>Сумма кредита</th><td>{money(amount)}</td></tr>
<tr><th>Срок</th><td>{term} мес.</td></tr>
<tr><th>Процентная ставка</th><td>{rate_text(rate)} годовых</td></tr>
<tr><th>Ежемесячный платёж</th><td>{money(summary.monthly_payment)}</td></tr>
<tr><th>Сумма процентов за срок</th><td>{money(summary.overpayment)}</td></tr>
<tr><th>Всего к возврату</th><td>{money(summary.total_payment)}</td></tr>
<tr><th>Цель</th><td>{escape_html(app.purpose or "Не указана")}</td></tr>
{security_rows(record, amount)}
</tbody>
</table>
<h3>3. Порядок погашения</h3>
<p>Погашение — ежемесячными аннуитетными платежами со списанием с расчётного счёта Заёмщика. Первые платежи графика:</p>
<table>
<thead><tr><th>№</th><th>Дата</th><th>Платёж</th><th>Основной долг</th><th>Проценты</th><th>Остаток</th></tr></thead>
<tbody>{first_rows}</tbody>
</table>
<p>Полный график платежей доступен в карточке заявки в кредитном кабинете. Досрочное погашение — без комиссий, с уведомлением за 1 рабочий день.</p>
{liability_html(revolving=False)}
{signed}
<p class="note">Документ сформирован в демонстрационном режиме и не является офертой.</p>
</article>"""


def liability_html(revolving: bool) -> str:
    overdue = "Если транш не погашен в срок" if revolving else "За просрочку платежа"
    return f"""<h3>4. Ответственность</h3>
<p>{overdue} начисляется неустойка 0,1% от суммы просроченной задолженности за каждый день просрочки. Сведения об исполнении обязательств передаются в бюро кредитных историй. При просрочке более 60 дней Кредитор вправе потребовать досрочного возврата кредита.</p>
<h3>5. Подписание</h3>
<p>Договор подписывается простой электронной подписью — вводом одноразового кода подтверждения в кредитном кабинете. Код приравнивается к собственноручной подписи уполномоченного лица Заёмщика.</p>"""
