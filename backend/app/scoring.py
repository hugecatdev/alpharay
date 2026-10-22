from app.annuity import credit_summary
from app.fmt import age_label, decimal_text, js_round, lower_first, money, months_between, percent, round_to
from app.models import StoredCompany
from app.schemas import (
    ActiveLoan,
    Application,
    CreditPolicy,
    Discrepancy,
    Financials,
    Grade,
    Recommendation,
    Scoring,
    ScoringFactor,
)

MODEL_VERSION = "rules-v1.2"

CLIENT_STRENGTHS = {
    "business_age": "Бизнес работает устойчиво несколько лет",
    "revenue_to_amount": "Сумма кредита соразмерна оборотам",
    "debt_load": "Платежи по кредитам занимают небольшую долю выручки",
    "payment_discipline": "Кредитная история без просрочек",
    "bki_rating": "Хорошая оценка бюро кредитных историй",
    "revenue_trend": "Обороты по счёту растут или стабильны",
    "profitability": "Бизнес стабильно прибыльный",
}
APPROVAL_FALLBACK = "Финансовые показатели и кредитная история соответствуют условиям продукта"
LOW_SCORE_REASON = "Финансовые показатели и кредитная история пока не соответствуют требованиям продукта"
RISK_MARKUP_REASON = "Ставка выше базовой с учётом оценки риска"


def stop_factors(mc: StoredCompany) -> list[str]:
    result: list[str] = []
    if mc.fns.tax_debt > 0:
        result.append(f"Налоговая задолженность {money(mc.fns.tax_debt)}")
    if mc.fns.account_blocks:
        result.append("Блокировки расчётных счетов по решению ФНС")
    if mc.bki.max_overdue_days_24m > 90:
        result.append(f"Просрочка по кредитам {mc.bki.max_overdue_days_24m} дней")
    if mc.fns.disqualified_head:
        result.append("Руководитель дисквалифицирован")
    if mc.fns.mass_address:
        result.append("Адрес массовой регистрации")
    return result


def _factor(code: str, name: str, value: str, points: int, maximum: int, comment: str) -> ScoringFactor:
    return ScoringFactor(
        code=code,
        name=name,
        value=value,
        points=max(0, min(maximum, points)),
        max_points=maximum,
        comment=comment,
    )


def _tier(value: float, steps: list[tuple[float, int]], fallback: int) -> int:
    for threshold, points in steps:
        if value >= threshold:
            return points
    return fallback


def compute_scoring(
    mc: StoredCompany,
    app: Application,
    financials: Financials,
    loans: list[ActiveLoan],
    now: int,
    policy: CreditPolicy,
) -> Scoring:
    factors: list[ScoringFactor] = []

    age = months_between(mc.company.registration_date, now)
    factors.append(
        _factor(
            "business_age",
            "Возраст бизнеса",
            age_label(age),
            _tier(age, [(60, 15), (36, 12), (24, 9), (12, 6)], 2),
            15,
            "Бизнес работает устойчиво несколько лет"
            if age >= 36
            else "Короткая история работы"
            if age >= 12
            else "Бизнесу меньше года — мало данных для оценки",
        )
    )

    revenue = financials.revenue_12m
    ratio = revenue / app.amount if app.amount > 0 else 0
    factors.append(
        _factor(
            "revenue_to_amount",
            "Выручка к сумме кредита",
            f"{decimal_text(ratio, 1)}×",
            _tier(ratio, [(10, 20), (6, 16), (3, 11), (1.5, 6)], 2),
            20,
            "Сумма кредита небольшая относительно оборота"
            if ratio >= 6
            else "Сумма соразмерна обороту"
            if ratio >= 3
            else "Сумма велика относительно годовой выручки",
        )
    )

    new_payment = credit_summary(app.product.repayment, app.amount, app.term, app.product.base_rate).monthly_payment
    existing = financials.monthly_debt_payments or sum(loan.monthly_payment for loan in loans)
    monthly_revenue = revenue / 12 or 1
    load = (existing + new_payment) / monthly_revenue * 100
    load_points = 20 if load <= 10 else 15 if load <= 20 else 10 if load <= 30 else 5 if load <= 45 else 0
    factors.append(
        _factor(
            "debt_load",
            "Платежи к выручке",
            f"{percent(load)} выручки",
            load_points,
            20,
            "Платежи по кредитам занимают небольшую долю выручки"
            if load <= 20
            else "Нагрузка умеренная"
            if load <= 30
            else "Высокая доля выручки уходит на платежи",
        )
    )

    overdue = mc.bki.max_overdue_days_24m
    discipline = 15 if overdue == 0 else 12 if overdue <= 5 else 8 if overdue <= 30 else 4 if overdue <= 90 else 0
    factors.append(
        _factor(
            "payment_discipline",
            "Платёжная дисциплина",
            "без просрочек" if overdue == 0 else f"просрочка до {overdue} дн.",
            discipline,
            15,
            "Обязательства исполнялись вовремя"
            if overdue == 0
            else "Были короткие просрочки"
            if overdue <= 30
            else "Существенная просрочка за последние 24 месяца",
        )
    )

    rating = mc.bki.rating
    factors.append(
        _factor(
            "bki_rating",
            "Рейтинг БКИ",
            f"{rating} — {mc.bki.rating_label}",
            _tier(rating, [(800, 10), (700, 8), (600, 6), (450, 3)], 0),
            10,
            "Оценка бюро кредитных историй",
        )
    )

    turnover = mc.turnover
    half = max(1, len(turnover) // 2)
    first = sum(month.inflow for month in turnover[:half]) / half
    second = sum(month.inflow for month in turnover[-half:]) / half
    growth = (second - first) / first * 100 if first > 0 else 0
    factors.append(
        _factor(
            "revenue_trend",
            "Динамика выручки",
            f"{'+' if growth >= 0 else ''}{percent(growth)} за полгода",
            _tier(growth, [(10, 10), (0, 8), (-10, 5)], 1),
            10,
            "Обороты растут или стабильны"
            if growth >= 0
            else "Небольшое снижение оборотов"
            if growth >= -10
            else "Обороты заметно снижаются",
        )
    )

    margin = financials.net_profit_12m / revenue * 100 if revenue > 0 else 0
    factors.append(
        _factor(
            "profitability",
            "Рентабельность",
            percent(margin, 1),
            _tier(margin, [(15, 10), (8, 8), (3, 5), (0, 3)], 0),
            10,
            "Бизнес стабильно прибыльный"
            if margin >= 8
            else "Невысокая маржа"
            if margin >= 0
            else "Деятельность убыточна",
        )
    )

    score = sum(item.points for item in factors)
    stops = stop_factors(mc)
    grade: Grade = "D" if stops else grade_for(score, policy)
    return Scoring(score=score, grade=grade, factors=factors, stop_factors=stops, model_version=MODEL_VERSION)


def client_approval_reasons(scoring: Scoring | None) -> list[str]:
    if not scoring:
        return [APPROVAL_FALLBACK]
    strong = sorted(
        (item for item in scoring.factors if item.max_points and item.points / item.max_points >= 0.8),
        key=lambda item: item.points / item.max_points,
        reverse=True,
    )
    reasons = [CLIENT_STRENGTHS[item.code] for item in strong if item.code in CLIENT_STRENGTHS][:2]
    return reasons or [APPROVAL_FALLBACK]


def grade_for(score: int, policy: CreditPolicy) -> Grade:
    for grade in ("A", "B", "C"):
        if score >= policy.grades[grade].min_score:
            return grade
    return "D"


def counter_amount(app: Application, policy: CreditPolicy) -> int:
    return max(app.product.min_amount, round_to(app.amount * policy.counter_offer_share, 50_000))


def compute_recommendation(scoring: Scoring, app: Application, policy: CreditPolicy) -> Recommendation:
    rate = app.product.base_rate + policy.grades[scoring.grade].rate_markup
    if scoring.stop_factors:
        return Recommendation(type="REJECTED", reasons=scoring.stop_factors)
    if scoring.grade == "A":
        return Recommendation(
            type="APPROVED",
            amount=app.amount,
            term=app.term,
            rate=rate,
            reasons=["Высокий балл скоринга", "Нет стоп-факторов"],
        )
    if scoring.grade == "B":
        reasons = ["Хороший балл скоринга"]
        if rate > app.product.base_rate:
            reasons.append("Ставка повышена с учётом умеренного риска")
        return Recommendation(type="APPROVED", amount=app.amount, term=app.term, rate=rate, reasons=reasons)
    if scoring.grade == "C":
        weak = [lower_first(item.name) for item in scoring.factors if item.points / item.max_points <= 0.35]
        return Recommendation(
            type="COUNTER_OFFER",
            amount=counter_amount(app, policy),
            term=app.term,
            rate=rate,
            reasons=[
                "Средний балл скоринга",
                f"Слабые факторы: {', '.join(weak)}" if weak else "Рекомендуется снизить сумму",
            ],
        )
    return Recommendation(type="REJECTED", reasons=["Низкий балл скоринга"])


def compute_discrepancies(mc: StoredCompany, app: Application) -> list[Discrepancy]:
    if not app.financials:
        return []
    result: list[Discrepancy] = []
    declared = app.financials.revenue_12m
    external = mc.fns.declared_revenue_12m
    if external > 0:
        diff = (declared - external) / external * 100
        if abs(diff) >= 10:
            result.append(
                Discrepancy(
                    field="revenue_12m",
                    label="Выручка за 12 месяцев",
                    declared=declared,
                    external=external,
                    diff_percent=js_round(diff * 10) / 10,
                )
            )
    employees = app.financials.employees_count
    registered = mc.company.employees_count
    if employees > 0 and registered > 0:
        diff = (employees - registered) / registered * 100
        if abs(diff) >= 30:
            result.append(
                Discrepancy(
                    field="employees_count",
                    label="Численность сотрудников",
                    declared=employees,
                    external=registered,
                    diff_percent=js_round(diff * 10) / 10,
                )
            )
    return result
