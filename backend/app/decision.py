import math
from dataclasses import dataclass, field

from app.annuity import credit_summary, max_amount_for_payment
from app.fmt import age_label, days_label, lower_first, money, months_between, percent
from app.insights import affordability_basis
from app.schemas import (
    ActiveLoan,
    CreditPolicy,
    DecisionType,
    Financials,
    InfoRequestItem,
    Product,
    Recommendation,
    Scoring,
)
from app.scoring import (
    LOW_SCORE_REASON,
    RISK_MARKUP_REASON,
    Sources,
    client_approval_reasons,
    compute_scoring,
    counter_amount,
    revenue_gap,
)

AMOUNT_STEP = 50_000
BKI_UNAVAILABLE = "Бюро кредитных историй не ответило после повторных запросов — заявку проверит специалист"
REVENUE_CONFIRMED = "Выручка подтверждена оборотами по счёту"
STATEMENT_CONFIRMED = "Выручка подтверждена выпиской по счёту"
REVENUE_ITEMS = (
    InfoRequestItem(code="revenue_12m", label="Уточните выручку за 12 месяцев", type="number"),
    InfoRequestItem(code="statement_6m", label="Выписка по счёту за 6 месяцев", type="document"),
)


@dataclass
class Verdict:
    type: DecisionType
    reasons: list[str]
    codes: list[str]
    amount: int | None = None
    term: int | None = None
    rate: float | None = None
    items: list[InfoRequestItem] = field(default_factory=list)
    comment: str = ""


@dataclass(frozen=True)
class Case:
    sources: Sources
    product: Product
    amount: int
    term: int
    financials: Financials
    loans: list[ActiveLoan]
    scoring: Scoring
    policy: CreditPolicy
    threshold: int
    now: int
    revenue_clarified: bool = False
    statement_provided: bool = False


def affordable_amount(product: Product, room: float, term: int, rate: float) -> int:
    if room <= 0 or rate <= 0:
        return 0
    raw = room * 1200 / rate if product.repayment == "REVOLVING" else max_amount_for_payment(room, term, rate)
    return math.floor(min(raw, product.max_amount) / AMOUNT_STEP) * AMOUNT_STEP


def grade_rate(case: Case, scoring: Scoring) -> float:
    return case.product.base_rate + case.policy.grades[scoring.grade].rate_markup


def business_age_verdict(case: Case) -> Verdict | None:
    age = months_between(case.sources.company.registration_date, case.now)
    minimum = case.policy.min_business_age_months
    if age >= minimum:
        return None
    return Verdict(
        "REJECTED",
        [f"Бизнес работает {age_label(age)} — кредит доступен после {minimum} мес. деятельности"],
        ["BUSINESS_TOO_YOUNG"],
    )


def revenue_verdict(case: Case) -> tuple[Verdict | None, str | None]:
    gap = revenue_gap(case.financials.revenue_12m, case.sources.fns.declared_revenue_12m)
    if gap is None or abs(gap) < case.policy.revenue_mismatch_percent:
        return None, None
    if not case.revenue_clarified:
        direction = "выше" if gap > 0 else "ниже"
        return (
            Verdict(
                "NEED_INFO",
                [f"Выручка в заявке расходится с данными ФНС на {percent(abs(gap))}"],
                ["REVENUE_MISMATCH"],
                items=[item.model_copy() for item in REVENUE_ITEMS],
                comment=f"Выручка в заявке заметно {direction}, чем в налоговой декларации. "
                "Уточните цифру и приложите выписку по счёту.",
            ),
            None,
        )
    banked = sum(month.inflow for month in case.sources.turnover[-12:])
    if banked > 0:
        confirmed = revenue_gap(case.financials.revenue_12m, banked)
        if confirmed is not None and abs(confirmed) < case.policy.revenue_mismatch_percent:
            return None, REVENUE_CONFIRMED
    elif case.statement_provided:
        return None, STATEMENT_CONFIRMED
    return (
        Verdict(
            "MANUAL_REVIEW",
            ["Уточнённая выручка не подтверждается оборотами по счёту — нужна проверка специалиста"],
            ["REVENUE_UNCONFIRMED"],
        ),
        None,
    )


def affordability_verdict(case: Case) -> Verdict | None:
    policy = case.policy
    flow, existing = affordability_basis(case.sources.turnover, case.loans, case.financials)
    if flow <= 0:
        return Verdict("REJECTED", ["Денежный поток бизнеса не покрывает платежи по кредитам"], ["NO_CASH_FLOW"])
    rate = grade_rate(case, case.scoring)
    payment = credit_summary(case.product.repayment, case.amount, case.term, rate).monthly_payment
    load = (existing + payment) / flow
    if load <= policy.max_debt_load:
        return None
    reduced = affordable_amount(case.product, flow * policy.max_debt_load - existing, case.term, rate)
    overloaded = Verdict(
        "REJECTED",
        [
            "Платежи по кредитам заняли бы слишком большую долю денежного потока бизнеса",
            "Даже минимальная сумма продукта не укладывается в допустимую нагрузку",
        ],
        ["HIGH_DEBT_LOAD"],
    )
    if reduced < case.product.min_amount:
        return overloaded
    rescored = compute_scoring(
        case.sources, case.product, reduced, case.term, case.financials, case.loans, case.now, policy
    )
    rule = policy.grades[rescored.grade]
    if rule.auto_decision == "REJECTED":
        return overloaded
    if rule.auto_decision == "MANUAL_REVIEW":
        return Verdict(
            "MANUAL_REVIEW",
            [f"Платёж по запрошенной сумме займёт {percent(load * 100)} денежного потока", "Нужна оценка специалиста"],
            ["HIGH_DEBT_LOAD"],
        )
    return Verdict(
        "COUNTER_OFFER",
        [
            "Платёж по запрошенной сумме занял бы слишком большую долю денежного потока бизнеса",
            f"Банк готов выдать {money(reduced)} — платежи уложатся в допустимую нагрузку",
        ],
        ["DEBT_LOAD_LIMIT"],
        amount=reduced,
        term=case.term,
        rate=grade_rate(case, rescored),
    )


def grade_verdict(case: Case, note: str | None) -> Verdict:
    rule = case.policy.grades[case.scoring.grade]
    rate = case.product.base_rate + rule.rate_markup
    if rule.auto_decision == "REJECTED":
        return Verdict("REJECTED", [LOW_SCORE_REASON], ["LOW_SCORE"])
    if rule.auto_decision == "MANUAL_REVIEW":
        return Verdict("MANUAL_REVIEW", ["Нужна экспертная оценка специалиста"], ["BORDERLINE_SCORE"])
    if rule.auto_decision == "COUNTER_OFFER":
        return Verdict(
            "COUNTER_OFFER",
            ["Условия скорректированы по кредитной политике банка"],
            ["POLICY_COUNTER_OFFER"],
            amount=counter_amount(case.product, case.amount, case.policy),
            term=case.term,
            rate=rate,
        )
    reasons = client_approval_reasons(case.scoring)
    codes = ["AUTO_APPROVED"]
    if note:
        reasons.append(note)
    if rule.rate_markup > 0:
        reasons.append(RISK_MARKUP_REASON)
        codes.append("RISK_MARKUP")
    return Verdict("APPROVED", reasons, codes, amount=case.amount, term=case.term, rate=rate)


def unavailable() -> Verdict:
    return Verdict("MANUAL_REVIEW", [BKI_UNAVAILABLE], ["INTEGRATION_ERROR"])


def decide(case: Case) -> Verdict:
    policy = case.policy
    stops = case.scoring.stop_factors
    if stops:
        if policy.stop_factors_decision == "REJECTED":
            return Verdict("REJECTED", list(stops), ["STOP_FACTORS"])
        return Verdict("MANUAL_REVIEW", ["Есть стоп-факторы — нужна оценка специалиста", *stops], ["STOP_FACTORS"])
    too_young = business_age_verdict(case)
    if too_young:
        return too_young
    mismatch, note = revenue_verdict(case)
    if mismatch:
        return mismatch
    if case.amount > case.threshold:
        return Verdict(
            "MANUAL_REVIEW",
            [f"Сумма выше порога автоматического решения {money(case.threshold)}"],
            ["AMOUNT_ABOVE_THRESHOLD"],
        )
    overdue = case.sources.bki.max_overdue_days_24m
    if overdue > policy.manual_review_overdue_days:
        return Verdict(
            "MANUAL_REVIEW",
            [f"В кредитной истории есть просрочка {days_label(overdue)}", "Нужна экспертная оценка специалиста"],
            ["OVERDUE_HISTORY"],
        )
    return affordability_verdict(case) or grade_verdict(case, note)


def recommend(case: Case) -> Recommendation:
    scoring = case.scoring
    if scoring.stop_factors:
        return Recommendation(type="REJECTED", reasons=list(scoring.stop_factors))
    too_young = business_age_verdict(case)
    if too_young:
        return Recommendation(type="REJECTED", reasons=too_young.reasons)
    limited = affordability_verdict(case)
    if limited and limited.type in ("COUNTER_OFFER", "REJECTED"):
        return Recommendation(
            type=limited.type, amount=limited.amount, term=limited.term, rate=limited.rate, reasons=limited.reasons
        )
    rate = grade_rate(case, scoring)
    if scoring.grade == "A":
        return Recommendation(
            type="APPROVED",
            amount=case.amount,
            term=case.term,
            rate=rate,
            reasons=["Высокий балл скоринга", "Нет стоп-факторов"],
        )
    if scoring.grade == "B":
        reasons = ["Хороший балл скоринга"]
        if rate > case.product.base_rate:
            reasons.append("Ставка повышена с учётом умеренного риска")
        return Recommendation(type="APPROVED", amount=case.amount, term=case.term, rate=rate, reasons=reasons)
    if scoring.grade == "C":
        weak = [lower_first(item.name) for item in scoring.factors if item.points / item.max_points <= 0.35]
        return Recommendation(
            type="COUNTER_OFFER",
            amount=counter_amount(case.product, case.amount, case.policy),
            term=case.term,
            rate=rate,
            reasons=[
                "Средний балл скоринга",
                f"Слабые факторы: {', '.join(weak)}" if weak else "Рекомендуется снизить сумму",
            ],
        )
    return Recommendation(type="REJECTED", reasons=["Низкий балл скоринга"])
