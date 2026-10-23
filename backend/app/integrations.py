from dataclasses import dataclass
from typing import Any, Protocol

from app.fmt import date_ru, money, money_short
from app.insights import bki_report, company_loans, monthly_debt
from app.models import CompanyRecord
from app.repo import Db
from app.schemas import ActiveLoan, BkiData, CheckStatus, CheckType, EgrulData, FnsData, TurnoverMonth
from app.scoring import ACTIVE_STATUS

MOCK_FAIL_NONE = 0
MOCK_FAIL_TRANSIENT = 1
MOCK_FAIL_OUTAGE = 2

SOURCE_NAMES: dict[CheckType, str] = {
    "COMPLETENESS": "Проверка анкеты",
    "EGRUL": "ЕГРЮЛ/ЕГРИП — симуляция",
    "FNS": "ФНС «Прозрачный бизнес» — симуляция",
    "BKI": "Бюро кредитных историй — симуляция",
    "ACCOUNT": "Счета клиента в банке — симуляция АБС",
}


class IntegrationError(Exception):
    pass


@dataclass(frozen=True)
class CheckOutcome:
    type: CheckType
    status: CheckStatus
    summary: str
    data: dict[str, Any] | None = None
    error: str | None = None


class SourceGateway(Protocol):
    def egrul(self, company: CompanyRecord) -> EgrulData: ...

    def fns(self, company: CompanyRecord) -> FnsData: ...

    def bki(self, db: Db, company: CompanyRecord, now: int, attempt: int, mock_fail: int) -> BkiData: ...

    def account(self, db: Db, company: CompanyRecord, now: int) -> tuple[list[TurnoverMonth], list[ActiveLoan]]: ...


class SyntheticGateway:
    def egrul(self, company: CompanyRecord) -> EgrulData:
        return company.egrul.model_copy(deep=True)

    def fns(self, company: CompanyRecord) -> FnsData:
        return company.fns.model_copy(deep=True)

    def bki(self, db: Db, company: CompanyRecord, now: int, attempt: int, mock_fail: int) -> BkiData:
        if mock_fail == MOCK_FAIL_OUTAGE or (mock_fail == MOCK_FAIL_TRANSIENT and attempt == 1):
            raise IntegrationError("Бюро кредитных историй не ответило за отведённое время (смоделированный сбой)")
        return bki_report(db, company, now)

    def account(self, db: Db, company: CompanyRecord, now: int) -> tuple[list[TurnoverMonth], list[ActiveLoan]]:
        return company.turnover, company_loans(db, company, now)


gateway: SourceGateway = SyntheticGateway()


def egrul_check(data: EgrulData, profile_head: str) -> CheckOutcome:
    issues: list[str] = []
    if data.status != ACTIVE_STATUS:
        issues.append(f"статус «{data.status}»")
    if data.head_name != profile_head:
        issues.append("руководитель не совпадает с профилем")
    summary = (
        f"{data.status}, зарегистрировано {date_ru(data.registration_date)}, ОКВЭД {data.okved_main}"
        if not issues
        else "Расхождения: " + ", ".join(issues)
    )
    return CheckOutcome("EGRUL", "ISSUES" if issues else "OK", summary, data.model_dump(mode="json"))


def fns_check(data: FnsData) -> CheckOutcome:
    issues: list[str] = []
    if data.tax_debt > 0:
        issues.append(f"налоговая задолженность {money(data.tax_debt)}")
    if data.account_blocks:
        issues.append("блокировки счетов")
    if data.mass_address:
        issues.append("адрес массовой регистрации")
    if data.disqualified_head:
        issues.append("дисквалифицированный руководитель")
    revenue = f"выручка по декларации {money_short(data.declared_revenue_12m)}"
    found = ", ".join(issues)
    summary = f"Нарушений нет, {revenue}" if not issues else f"{found[:1].upper()}{found[1:]}; {revenue}"
    return CheckOutcome("FNS", "ISSUES" if issues else "OK", summary, data.model_dump(mode="json"))


def bki_check(data: BkiData) -> CheckOutcome:
    overdue = data.max_overdue_days_24m
    summary = f"Рейтинг {data.rating} ({data.rating_label.lower()}), " + (
        "просрочек за 24 мес. нет" if overdue == 0 else f"просрочка до {overdue} дн. за 24 мес."
    )
    return CheckOutcome("BKI", "ISSUES" if overdue > 0 else "OK", summary, data.model_dump(mode="json"))


def bki_failure(attempt: int, attempts: int, error: str) -> CheckOutcome:
    return CheckOutcome("BKI", "ERROR", f"Нет ответа — попытка {attempt} из {attempts}", None, error)


def account_check(turnover: list[TurnoverMonth], loans: list[ActiveLoan]) -> CheckOutcome:
    data = {
        "turnover": [month.model_dump(mode="json") for month in turnover],
        "loans": [loan.model_dump(mode="json") for loan in loans],
    }
    if not turnover:
        summary = "Счёта в банке нет — обороты возьмём из анкеты"
    else:
        inflow = sum(month.inflow for month in turnover)
        summary = (
            f"Поступления за {len(turnover)} мес. — {money_short(inflow)}, "
            f"платежи по кредитам {money(monthly_debt(loans))} в месяц"
        )
    return CheckOutcome("ACCOUNT", "OK", summary, data)
