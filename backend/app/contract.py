from app.annuity import build_schedule, credit_summary
from app.fmt import date_ru, escape_html, money, percent, rate_text
from app.labels import COLLATERAL_LABELS
from app.models import ApplicationRecord
from app.schemas import ContractRef

DEMO_NOTE = (
    "Демонстрационный договор: данные синтетические, подписание и выдача смоделированы — "
    "юридической силы документ не имеет, реальные деньги не перечисляются."
)


def loan_terms(record: ApplicationRecord) -> tuple[int, int, float]:
    offer = record.offer
    if offer:
        return offer.amount, offer.term, offer.rate
    return record.amount, record.term, record.product.base_rate


def schedule_start(record: ApplicationRecord, now: int) -> int:
    return record.disbursed_at if record.disbursed_at is not None else now


def security_rows(record: ApplicationRecord, amount: int) -> str:
    product = record.product
    rows = ""
    if product.collateral != "NONE":
        subject = (
            "приобретаемое оборудование"
            if product.collateral == "EQUIPMENT"
            else COLLATERAL_LABELS[product.collateral].lower()
        )
        rows += f"<tr><th>Обеспечение</th><td>{escape_html(subject)}</td></tr>"
    if product.down_payment_share > 0:
        share = product.down_payment_share
        cost = round(amount / (1 - share))
        rows += (
            f"<tr><th>Собственный аванс Заёмщика</th><td>не менее {percent(share * 100)} стоимости — "
            f"от {money(cost - amount)} при стоимости {money(cost)}</td></tr>"
        )
    return rows


def revolving_html(record: ApplicationRecord, amount: int, term: int, rate: float) -> str:
    interest = credit_summary("REVOLVING", amount, term, rate).monthly_payment
    return f"""<h3>2. Предмет договора</h3>
<p>Кредитор устанавливает лимит овердрафта к расчётному счёту Заёмщика «{escape_html(record.product.name)}»:</p>
<table>
<tbody>
<tr><th>Лимит овердрафта</th><td>{money(amount)}</td></tr>
<tr><th>Срок действия лимита</th><td>{term} мес.</td></tr>
<tr><th>Процентная ставка</th><td>{rate_text(rate)} годовых на фактическую задолженность</td></tr>
<tr><th>Проценты в месяц при полном использовании лимита</th><td>{money(interest)}</td></tr>
<tr><th>Цель</th><td>{escape_html(record.purpose or "Не указана")}</td></tr>
</tbody>
</table>
<h3>3. Порядок погашения</h3>
<p>Поступления на расчётный счёт автоматически погашают задолженность. Каждый транш погашается не позднее 60 календарных дней с даты его предоставления. Проценты начисляются ежедневно на фактическую задолженность и уплачиваются ежемесячно. Если лимит не используется, проценты не начисляются. Графика аннуитетных платежей нет.</p>"""


def contract_html(record: ApplicationRecord, now: int) -> str:
    amount, term, rate = loan_terms(record)
    company = record.company
    revolving = record.product.repayment == "REVOLVING"
    reference = record.contract.ref() if record.contract else None
    number = reference.number if reference else f"ДК-{record.number.replace('КР-', '')}"
    signed_at = reference.signed_at if reference else None
    title = "Договор об овердрафтном кредитовании" if revolving else "Кредитный договор"
    parties = f"""<h2>{title} № {escape_html(number)}</h2>
<p class="meta">г. Москва · {date_ru(signed_at or now)}</p>
<p class="meta">{DEMO_NOTE}</p>
<h3>1. Стороны</h3>
<p><strong>Кредитор:</strong> Банк AlphaRay.</p>
<p><strong>Заёмщик:</strong> {escape_html(company.name)}, ИНН {escape_html(company.inn)}, ОГРН {escape_html(company.ogrn)}, адрес: {escape_html(company.address)}, в лице {escape_html(company.head_name)}.</p>"""
    if revolving:
        return f"""<article class="contract">
{parties}
{revolving_html(record, amount, term, rate)}
{liability_html(revolving=True)}
{signing_html(reference)}
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
<p>Кредитор предоставляет Заёмщику кредит «{escape_html(record.product.name)}» на следующих условиях:</p>
<table>
<tbody>
<tr><th>Сумма кредита</th><td>{money(amount)}</td></tr>
<tr><th>Срок</th><td>{term} мес.</td></tr>
<tr><th>Процентная ставка</th><td>{rate_text(rate)} годовых</td></tr>
<tr><th>Ежемесячный платёж</th><td>{money(summary.monthly_payment)}</td></tr>
<tr><th>Сумма процентов за срок</th><td>{money(summary.overpayment)}</td></tr>
<tr><th>Всего к возврату</th><td>{money(summary.total_payment)}</td></tr>
<tr><th>Цель</th><td>{escape_html(record.purpose or "Не указана")}</td></tr>
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
{signing_html(reference)}
</article>"""


def liability_html(revolving: bool) -> str:
    overdue = "Если транш не погашен в срок" if revolving else "За просрочку платежа"
    return f"""<h3>4. Ответственность</h3>
<p>{overdue} начисляется неустойка 0,1% от суммы просроченной задолженности за каждый день просрочки. Сведения об исполнении обязательств передаются в бюро кредитных историй. При просрочке более 60 дней Кредитор вправе потребовать досрочного возврата кредита.</p>"""


def signing_html(contract: ContractRef | None) -> str:
    signed_at = contract.signed_at if contract else None
    if contract and signed_at and contract.signed_with == "PEP":
        return f"""<h3>5. Подписание</h3>
<p>Договор подписан простой электронной подписью — вводом одноразового кода подтверждения в кредитном кабинете. Код приравнивается к собственноручной подписи уполномоченного лица Заёмщика в соответствии с соглашением об электронном документообороте.</p>
<p class="signed">Подписан простой электронной подписью {date_ru(signed_at)}.</p>"""
    terms = """<h3>5. Подписание</h3>
<p>Договор подписывается усиленной квалифицированной электронной подписью руководителя Заёмщика, а для индивидуального предпринимателя — самого предпринимателя. Сертификат подписи выдаёт Удостоверяющий центр ФНС России. Такая подпись равнозначна собственноручной без отдельного соглашения сторон (ч. 1 ст. 6 Федерального закона от 06.04.2011 № 63-ФЗ «Об электронной подписи»).</p>"""
    certificate = contract.certificate if contract else None
    if not signed_at or not certificate:
        return terms
    return f"""{terms}
<p class="signed">Подписан квалифицированной электронной подписью {date_ru(signed_at)}: {escape_html(certificate.owner_name)}, {escape_html(certificate.owner_title.lower())}, {escape_html(certificate.organization)}. Сертификат № {certificate.serial}, выдан {escape_html(certificate.issuer)}, действителен до {date_ru(certificate.valid_to)}.</p>"""
