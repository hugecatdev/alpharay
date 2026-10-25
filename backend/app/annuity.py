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


def amortization(amount: float, term: int, rate: float) -> list[tuple[int, int, int, int]]:
    payment = js_round(annuity_payment(amount, term, rate))
    balance = max(0, js_round(amount))
    rows = []
    for index in range(1, term + 1):
        interest = js_round(balance * rate / 1200)
        principal = balance if index == term else min(balance, max(0, payment - interest))
        balance -= principal
        rows.append((principal + interest, principal, interest, balance))
    return rows


def loan_summary(amount: float, term: int, rate: float) -> LoanSummary:
    monthly = js_round(annuity_payment(amount, term, rate))
    total = sum(row[0] for row in amortization(amount, term, rate))
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
    start = local(start_ms)
    rows: list[Payment] = []
    for index, (payment, principal, interest, balance) in enumerate(amortization(amount, term, rate), start=1):
        year, month = shift_month(start.year, start.month, index)
        date = datetime(year, month, min(start.day, 28), tzinfo=TZ)
        rows.append(
            Payment(
                date=iso(to_ms(date)),
                amount=payment,
                principal=principal,
                interest=interest,
                balance=balance,
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
