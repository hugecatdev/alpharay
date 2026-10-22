from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app import store as store_module
from app.config import settings
from app.main import create_app

START = 1_792_573_200_000


class Clock:
    def __init__(self) -> None:
        self.value = START

    def __call__(self) -> int:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += int(seconds * 1000)


class Api:
    def __init__(self, client: TestClient, clock: Clock) -> None:
        self.client = client
        self.clock = clock
        self.headers: dict[str, str] = {}

    def login(self, email: str) -> dict:
        response = self.client.post("/api/auth/login", json={"email": email, "password": "demo"})
        assert response.status_code == 200, response.text
        body = response.json()
        self.headers = {"Authorization": f"Bearer {body['access_token']}"}
        return body["user"]

    def get(self, path: str, **kwargs):
        return self.client.get(f"/api{path}", headers=self.headers, **kwargs)

    def post(self, path: str, **kwargs):
        return self.client.post(f"/api{path}", headers=self.headers, **kwargs)

    def patch(self, path: str, **kwargs):
        return self.client.patch(f"/api{path}", headers=self.headers, **kwargs)

    def delete(self, path: str, **kwargs):
        return self.client.delete(f"/api{path}", headers=self.headers, **kwargs)

    def ok(self, response, status: int = 200):
        assert response.status_code == status, response.text
        return response.json() if response.content else None

    def wait(self, application_id: str, seconds: float = 12) -> dict:
        self.clock.advance(seconds)
        return self.ok(self.get(f"/applications/{application_id}"))

    def fill_draft(self, product_code: str, amount: int, term: int, purpose_type: str = "WORKING_CAPITAL") -> dict:
        draft = self.ok(
            self.post(
                "/applications",
                json={
                    "product_code": product_code,
                    "amount": amount,
                    "term": term,
                    "purpose": "",
                    "purpose_type": purpose_type,
                },
            ),
            201,
        )
        insights = self.ok(self.get("/company/insights"))
        revenue = sum(month["inflow"] for month in insights["turnover"])
        expenses = sum(month["outflow"] for month in insights["turnover"])
        return self.ok(
            self.patch(
                f"/applications/{draft['id']}",
                json={
                    "company_confirmed": True,
                    "financials": {
                        "revenue_12m": revenue,
                        "revenue_last_3m": [month["inflow"] for month in insights["turnover"][-3:]],
                        "expenses_12m": expenses,
                        "net_profit_12m": revenue - expenses,
                        "monthly_debt_payments": sum(loan["monthly_payment"] for loan in insights["loans"]),
                        "employees_count": 10,
                        "tax_system": "USN_15",
                    },
                    "consents": {"bki": True, "personal_data": True, "risks": True},
                },
            )
        )


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    value = Clock()
    monkeypatch.setattr(store_module, "now_ms", value)
    return value


@pytest.fixture
def configure(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "data_file", "")
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "llm_api_key", "")
    monkeypatch.setattr(settings, "demo_reset_enabled", True)


@pytest.fixture
def api(clock: Clock, configure: None) -> Iterator[Api]:
    with TestClient(create_app()) as client:
        yield Api(client, clock)
