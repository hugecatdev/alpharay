import pytest

from app.annuity import annuity_payment, build_schedule, loan_summary
from app.contract import schedule_html


@pytest.mark.parametrize(
    ('amount', 'term', 'rate'),
    [(400_000, 24, 19.5), (2_000_000, 60, 25.9), (100, 3, 0), (1, 24, 0), (0, 12, 19.5), (500_000, 1, 12)],
)
def test_schedule_reconciles_with_summary(amount: int, term: int, rate: float) -> None:
    schedule = build_schedule(amount, term, rate, 1_792_573_200_000)
    summary = loan_summary(amount, term, rate)
    balance = amount
    for row in schedule:
        assert row.amount == row.principal + row.interest
        assert row.balance == balance - row.principal
        assert min(row.amount, row.principal, row.interest, row.balance) >= 0
        balance = row.balance
    assert balance == 0
    assert sum(row.principal for row in schedule) == amount
    assert sum(row.amount for row in schedule) == summary.total_payment
    assert sum(row.interest for row in schedule) == summary.overpayment


def test_reported_contract_example() -> None:
    assert annuity_payment(400_000, 24, 19.5) == pytest.approx(20_260.75064084251, abs=0.001)
    schedule = build_schedule(400_000, 24, 19.5, 1_792_573_200_000)
    assert all(row.amount == 20_261 for row in schedule[:-1])
    assert schedule[-1].amount == 20_253
    assert loan_summary(400_000, 24, 19.5).overpayment == 86_256
    html = schedule_html(schedule)
    assert 'разница учитывается' not in html
    assert 'Итоговые суммы равны суммам строк графика' in html
