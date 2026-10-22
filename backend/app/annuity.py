from dataclasses import dataclass
from datetime import datetime

from app.fmt import TZ, iso, js_round, local, shift_month, to_ms
from app.schemas import Payment, Repayment


@dataclass(frozen=True)
class LoanSummary:
    monthly_payment: int
    total_payment: int
    overpayment: int


def annuity_payment(amount: float, term: int, rate: float) -> float:
    if amount <= 0 or term <= 0:
        return 0.0
    monthly = rate / 1200
    if monthly == 0:
        return amount / term
    return amount * monthly / (1 - (1 + monthly) ** -term)


def loan_summary(amount: float, term: int, rate: float) -> LoanSummary:
    monthly = js_round(annuity_payment(amount, term, rate))
    total = monthly * term
    return LoanSummary(monthly_payment=monthly, total_payment=total, overpayment=max(0, js_round(total - amount)))


def revolving_summary(amount: float, term: int, rate: float) -> LoanSummary:
    monthly = js_round(amount * rate / 1200) if amount > 0 else 0
    overpayment = monthly * max(0, term)
    return LoanSummary(monthly_payment=monthly, total_payment=js_round(amount) + overpayment, overpayment=overpayment)


def credit_summary(repayment: Repayment, amount: float, term: int, rate: float) -> LoanSummary:
    if repayment == "REVOLVING":
        return revolving_summary(amount, term, rate)
    return loan_summary(amount, term, rate)


def max_amount_for_payment(payment: float, term: int, rate: float) -> float:
    monthly = rate / 1200
    if monthly == 0:
        return payment * term
    return payment * (1 - (1 + monthly) ** -term) / monthly


def build_schedule(amount: float, term: int, rate: float, start_ms: int) -> list[Payment]:
    monthly = rate / 1200
    payment = annuity_payment(amount, term, rate)
    start = local(start_ms)
    rows: list[Payment] = []
    balance = float(amount)
    for index in range(1, term + 1):
        interest = balance * monthly
        principal = balance if index == term else payment - interest
        balance = max(0.0, balance - principal)
        year, month = shift_month(start.year, start.month, index)
        date = datetime(year, month, min(start.day, 28), tzinfo=TZ)
        rows.append(
            Payment(
                date=iso(to_ms(date)),
                amount=js_round(principal + interest),
                principal=js_round(principal),
                interest=js_round(interest),
                balance=js_round(balance),
            )
        )
    return rows


def revolving_schedule(amount: float, term: int, rate: float, start_ms: int) -> list[Payment]:
    interest = js_round(amount * rate / 1200)
    start = local(start_ms)
    rows: list[Payment] = []
    for index in range(1, term + 1):
        year, month = shift_month(start.year, start.month, index)
        date = datetime(year, month, min(start.day, 28), tzinfo=TZ)
        last = index == term
        rows.append(
            Payment(
                date=iso(to_ms(date)),
                amount=interest + (js_round(amount) if last else 0),
                principal=js_round(amount) if last else 0,
                interest=interest,
                balance=0 if last else js_round(amount),
            )
        )
    return rows


def credit_schedule(repayment: Repayment, amount: float, term: int, rate: float, start_ms: int) -> list[Payment]:
    if repayment == "REVOLVING":
        return revolving_schedule(amount, term, rate, start_ms)
    return build_schedule(amount, term, rate, start_ms)
