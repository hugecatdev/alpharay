import math

from app.annuity import credit_schedule, credit_summary, max_amount_for_payment
from app.fmt import iso, js_round, parse_ms
from app.models import CompanyRecord
from app.repo import Db
from app.schemas import ActiveLoan, BkiData, BkiLoan, CompanyInsights, Financials, TurnoverMonth
from app.scoring import stop_factors

OWN_BANK = "AlphaRay Банк"
COMFORT_LOAD = 0.4
HIGH_LOAD = 0.7
LIMIT_TERM = 24
LIMIT_PRODUCT = "WORKING_CAPITAL"
LIMIT_FALLBACK_RATE = 19.5
LIMIT_STEP = 50_000


def avg_free_cash_flow(turnover: list[TurnoverMonth]) -> int:
    if not turnover:
        return 0
    total = sum(month.inflow - month.outflow for month in turnover)
    return js_round(total / len(turnover))


def monthly_debt(loans: list[ActiveLoan]) -> int:
    return sum(loan.monthly_payment for loan in loans)


def operating_cash_flow(turnover: list[TurnoverMonth], loans: list[ActiveLoan]) -> int:
    if not turnover:
        return 0
    return avg_free_cash_flow(turnover) + monthly_debt(loans)


def debt_load(turnover: list[TurnoverMonth], loans: list[ActiveLoan], new_payment: float = 0) -> float | None:
    flow = operating_cash_flow(turnover, loans)
    if flow <= 0:
        return None
    return (monthly_debt(loans) + new_payment) / flow


def affordability_basis(
    turnover: list[TurnoverMonth], loans: list[ActiveLoan], financials: Financials
) -> tuple[int, int]:
    if turnover:
        return operating_cash_flow(turnover, loans), monthly_debt(loans)
    existing = financials.monthly_debt_payments
    return js_round((financials.revenue_12m - financials.expenses_12m) / 12) + existing, existing


def limit_rate(db: Db) -> float:
    product = db.find_product(LIMIT_PRODUCT)
    return product.base_rate if product else LIMIT_FALLBACK_RATE


def pre_approved_limit(db: Db, mc: CompanyRecord, now: int) -> int:
    if not mc.turnover or stop_factors(mc.fns, mc.bki, mc.egrul):
        return 0
    loans = company_loans(db, mc, now)
    room = operating_cash_flow(mc.turnover, loans) * COMFORT_LOAD - monthly_debt(loans)
    if room <= 0:
        return 0
    amount = max_amount_for_payment(room, LIMIT_TERM, limit_rate(db))
    return max(0, math.floor(amount / LIMIT_STEP) * LIMIT_STEP)


def own_loans(db: Db, mc: CompanyRecord, now: int) -> list[ActiveLoan]:
    own: list[ActiveLoan] = []
    for app in db.disbursed_of_company(mc.id):
        disbursed_at = app.disbursed_at
        if disbursed_at is None:
            continue
        rate = app.offer.rate if app.offer else app.product.base_rate
        repayment = app.product.repayment
        schedule = credit_schedule(repayment, app.amount, app.term, rate, disbursed_at)
        upcoming = next((row for row in schedule if parse_ms(row.date) > now), None)
        if not upcoming:
            continue
        paid = [row for row in schedule if parse_ms(row.date) <= now]
        own.append(
            ActiveLoan(
                id=app.id,
                contract_number=app.contract.number if app.contract else app.number,
                product_name=app.product.name,
                amount=app.amount,
                balance=paid[-1].balance if paid else app.amount,
                rate=rate,
                monthly_payment=credit_summary(repayment, app.amount, app.term, rate).monthly_payment,
                next_payment_date=upcoming.date,
                issued_at=iso(disbursed_at),
                maturity_date=schedule[-1].date,
            )
        )
    return own


def company_loans(db: Db, mc: CompanyRecord, now: int) -> list[ActiveLoan]:
    return [*mc.external_loans, *own_loans(db, mc, now)]


def bki_report(db: Db, mc: CompanyRecord, now: int) -> BkiData:
    external = [loan for loan in mc.bki.active_loans if loan.creditor != OWN_BANK]
    own = [
        BkiLoan(
            creditor=OWN_BANK,
            amount=loan.amount,
            balance=loan.balance,
            opened_at=loan.issued_at,
            closed_at=None,
            max_overdue_days=0,
        )
        for loan in own_loans(db, mc, now)
    ]
    return mc.bki.model_copy(update={"active_loans": [*external, *own]})


def company_insights(db: Db, mc: CompanyRecord, now: int) -> CompanyInsights:
    return CompanyInsights(
        turnover=mc.turnover,
        avg_free_cash_flow=avg_free_cash_flow(mc.turnover),
        pre_approved_limit=pre_approved_limit(db, mc, now),
        loans=company_loans(db, mc, now),
    )


def derived_financials(db: Db, mc: CompanyRecord, now: int) -> Financials:
    revenue = sum(month.inflow for month in mc.turnover)
    expenses = sum(month.outflow for month in mc.turnover)
    debt = monthly_debt(company_loans(db, mc, now))
    return Financials(
        revenue_12m=revenue,
        revenue_last_3m=[month.inflow for month in mc.turnover[-3:]],
        expenses_12m=expenses,
        net_profit_12m=revenue - expenses,
        monthly_debt_payments=debt,
        employees_count=mc.company.employees_count,
        tax_system=mc.company.tax_system,
    )
