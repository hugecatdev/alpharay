import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app import clock as clock_module
from app.bootstrap import clear, prepare
from app.config import settings
from app.db import Database
from app.main import create_app
from app.worker import process_due

START = 1_792_573_200_000
DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://postgres:test@127.0.0.1:55432/alpharay_test")


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

    @property
    def database(self) -> Database:
        return self.client.app.state.database

    def login(self, email: str) -> dict:
        response = self.client.post("/api/auth/login", json={"email": email, "password": "demo"})
        assert response.status_code == 200, response.text
        body = response.json()
        self.headers = {"Authorization": f"Bearer {body['access_token']}"}
        return body["user"]

    def get(self, path: str, **kwargs):
        return self.client.get(f"/api{path}", headers={**self.headers, **kwargs.pop("headers", {})}, **kwargs)

    def post(self, path: str, **kwargs):
        return self.client.post(f"/api{path}", headers={**self.headers, **kwargs.pop("headers", {})}, **kwargs)

    def patch(self, path: str, **kwargs):
        return self.client.patch(f"/api{path}", headers={**self.headers, **kwargs.pop("headers", {})}, **kwargs)

    def put(self, path: str, **kwargs):
        return self.client.put(f"/api{path}", headers={**self.headers, **kwargs.pop("headers", {})}, **kwargs)

    def delete(self, path: str, **kwargs):
        return self.client.delete(f"/api{path}", headers={**self.headers, **kwargs.pop("headers", {})}, **kwargs)

    def ok(self, response, status: int = 200):
        assert response.status_code == status, response.text
        return response.json() if response.content else None

    def advance(self, seconds: float) -> int:
        self.clock.advance(seconds)
        return process_due(self.database, self.clock())

    def wait(self, application_id: str, seconds: float = 12) -> dict:
        self.advance(seconds)
        return self.ok(self.get(f"/applications/{application_id}"))

    def financials(self, revenue: int | None = None) -> dict:
        insights = self.ok(self.get("/company/insights"))
        inflow = sum(month["inflow"] for month in insights["turnover"])
        expenses = sum(month["outflow"] for month in insights["turnover"])
        revenue = inflow if revenue is None else revenue
        if not insights["turnover"]:
            expenses = round(revenue * 0.8)
        return {
            "revenue_12m": revenue,
            "revenue_last_3m": [month["inflow"] for month in insights["turnover"][-3:]],
            "expenses_12m": expenses,
            "net_profit_12m": revenue - expenses,
            "monthly_debt_payments": sum(loan["monthly_payment"] for loan in insights["loans"]),
            "employees_count": 10,
            "tax_system": "USN_15",
        }

    def fill_draft(
        self,
        product_code: str,
        amount: int,
        term: int,
        purpose_type: str = "WORKING_CAPITAL",
        revenue: int | None = None,
    ) -> dict:
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
        return self.ok(
            self.patch(
                f"/applications/{draft['id']}",
                json={
                    "company_confirmed": True,
                    "financials": self.financials(revenue),
                    "consents": {"bki": True, "personal_data": True, "risks": True},
                },
            )
        )

    def approved(self, product_code: str = "WORKING_CAPITAL", amount: int = 2_000_000, term: int = 24) -> dict:
        draft = self.fill_draft(product_code, amount, term)
        self.ok(self.post(f"/applications/{draft['id']}/submit"))
        approved = self.wait(draft["id"])
        assert approved["status"] == "APPROVED", approved
        return approved


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    previous = (settings.database_url, settings.demo_seed)
    settings.database_url = DATABASE_URL
    settings.demo_seed = False
    database = Database(DATABASE_URL)
    try:
        prepare(database)
    finally:
        database.dispose()
        settings.database_url, settings.demo_seed = previous
    yield DATABASE_URL


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    value = Clock()
    monkeypatch.setattr(clock_module, "now_ms", value)
    return value


@pytest.fixture
def configure(monkeypatch: pytest.MonkeyPatch, tmp_path, database_url: str) -> None:
    monkeypatch.setattr(settings, "database_url", database_url)
    monkeypatch.setattr(settings, "demo_seed", True)
    monkeypatch.setattr(settings, "pipeline_worker", False)
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    monkeypatch.setattr(settings, "log_format", "text")
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "llm_api_key", "")
    monkeypatch.setattr(settings, "demo_reset_enabled", True)
    database = Database(database_url)
    try:
        with database.engine.begin() as connection:
            clear(connection)
    finally:
        database.dispose()


@pytest.fixture
def api(clock: Clock, configure: None) -> Iterator[Api]:
    with TestClient(create_app()) as client:
        yield Api(client, clock)
