import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import settings
from app.main import create_app
from app.models import DisbursementRecord
from app.pipeline import SYSTEM, TransitionError, set_status
from app.repo import Db
from tests.conftest import Api

DAY = 24 * 60 * 60


def disbursements(api: Api, application_id: str) -> int:
    with api.database.session() as session:
        query = select(func.count()).where(DisbursementRecord.application_id == application_id)
        return session.scalar(query) or 0


def test_offer_expires_and_cannot_be_accepted(api: Api) -> None:
    api.login("client1@demo.local")
    app = api.approved()
    valid_until = app["offer"]["valid_until"]

    api.clock.advance(15 * DAY)
    late = api.post(f"/applications/{app['id']}/offer/accept")
    assert late.status_code == 409 and late.json()["code"] == "OFFER_EXPIRED"

    api.advance(0)
    expired = api.ok(api.get(f"/applications/{app['id']}"))
    assert expired["status"] == "EXPIRED" and expired["offer"]["status"] == "EXPIRED"
    assert expired["offer"]["valid_until"] == valid_until
    assert api.post(f"/applications/{app['id']}/offer/accept").json()["code"] == "INVALID_STATUS"
    assert api.post(f"/applications/{app['id']}/sign").status_code == 409
    kinds = [item["type"] for item in api.ok(api.get("/notifications"))]
    assert "OFFER_EXPIRED" in kinds


def test_outdated_offer_version_is_rejected(api: Api) -> None:
    api.login("client1@demo.local")
    app = api.approved()
    stale = api.post(f"/applications/{app['id']}/offer/accept", json={"offer_id": "old-offer"})
    assert stale.status_code == 409 and stale.json()["code"] == "OFFER_OUTDATED"
    assert api.ok(api.get(f"/applications/{app['id']}"))["status"] == "APPROVED"


def test_declined_offer_closes_application(api: Api) -> None:
    api.login("client1@demo.local")
    app = api.approved()
    declined = api.ok(api.post(f"/applications/{app['id']}/offer/decline"))
    assert declined["status"] == "CLIENT_DECLINED" and declined["offer"]["status"] == "DECLINED"
    assert api.post(f"/applications/{app['id']}/sign").status_code == 409
    assert api.post(f"/applications/{app['id']}/cancel").status_code == 409


def test_idempotent_submit_replays_result(api: Api) -> None:
    api.login("client1@demo.local")
    draft = api.fill_draft("WORKING_CAPITAL", 2_000_000, 24)
    headers = {"Idempotency-Key": "submit-1"}
    first = api.post(f"/applications/{draft['id']}/submit", headers=headers)
    second = api.post(f"/applications/{draft['id']}/submit", headers=headers)
    assert first.status_code == second.status_code == 200
    assert second.headers["Idempotent-Replayed"] == "true" and second.json() == first.json()

    plain = api.post(f"/applications/{draft['id']}/submit")
    assert plain.status_code == 409 and plain.json()["code"] == "INVALID_STATUS"
    reused = api.post(f"/applications/{draft['id']}/cancel", headers=headers)
    assert reused.status_code == 422 and reused.json()["code"] == "IDEMPOTENCY_KEY_REUSED"

    events = api.ok(api.get(f"/applications/{draft['id']}/events"))
    assert [event["to_status"] for event in events].count("SUBMITTED") == 1


def test_single_disbursement_with_repeated_command(api: Api) -> None:
    api.login("admin@bank.local")
    policy = api.ok(api.get("/admin/policy"))
    policy.pop("updated_at")
    policy.pop("updated_by")
    policy.pop("version")
    api.ok(api.put("/admin/policy", json={**policy, "auto_disbursement": False}))

    api.login("client1@demo.local")
    app = api.approved(amount=1_000_000, term=12)
    api.ok(api.post(f"/applications/{app['id']}/offer/accept"))
    api.ok(api.post(f"/applications/{app['id']}/sign"))
    api.ok(api.post(f"/applications/{app['id']}/sign/confirm", json={"code": "4821"}))

    api.login("underwriter@bank.local")
    headers = {"Idempotency-Key": "disburse-1"}
    first = api.ok(api.post(f"/bank/applications/{app['id']}/disburse", headers=headers))
    again = api.post(f"/bank/applications/{app['id']}/disburse", headers=headers)
    assert again.status_code == 200 and again.json()["disbursement"] == first["disbursement"]
    assert api.post(f"/bank/applications/{app['id']}/disburse").status_code == 409
    assert disbursements(api, app["id"]) == 1


def test_patch_requires_current_version(api: Api) -> None:
    api.login("client1@demo.local")
    draft = api.ok(api.post("/applications", json={"product_code": "WORKING_CAPITAL", "amount": 1_000_000}), 201)
    fresh = api.patch(f"/applications/{draft['id']}", json={"amount": 1_200_000}, headers={"If-Match": '"1"'})
    assert fresh.status_code == 200 and fresh.json()["version"] == 2 and fresh.headers["ETag"] == '"2"'
    stale = api.patch(f"/applications/{draft['id']}", json={"amount": 1_500_000}, headers={"If-Match": '"1"'})
    assert stale.status_code == 409 and stale.json()["code"] == "VERSION_CONFLICT"
    assert api.ok(api.get(f"/applications/{draft['id']}"))["amount"] == 1_200_000
    broken = api.patch(f"/applications/{draft['id']}", json={"amount": 1}, headers={"If-Match": "abc"})
    assert broken.status_code == 422


def test_resubmit_after_rejection_keeps_old_decision(api: Api) -> None:
    api.login("client4@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 1_000_000, 12)
    api.ok(api.post(f"/applications/{app['id']}/submit"))
    rejected = api.wait(app["id"])
    assert rejected["status"] == "REJECTED"

    copy = api.ok(api.post(f"/applications/{app['id']}/resubmit"), 201)
    assert copy["status"] == "DRAFT" and copy["previous_application_id"] == app["id"]
    assert copy["id"] != app["id"] and copy["number"] != app["number"]
    assert copy["amount"] == 1_000_000 and copy["financials"] == rejected["financials"]
    assert copy["consents"] == {"bki": False, "personal_data": False, "risks": False}
    assert api.ok(api.get(f"/applications/{app['id']}"))["decision"] == rejected["decision"]
    reasons = [event["reason"] for event in api.ok(api.get(f"/applications/{copy['id']}/events"))]
    assert reasons == [f"Повторная подача по заявке {app['number']}"]
    assert api.post(f"/applications/{copy['id']}/resubmit").status_code == 409


def test_invalid_transitions_are_refused(api: Api) -> None:
    api.login("client1@demo.local")
    history = next(item for item in api.ok(api.get("/applications")) if item["status"] == "DISBURSED")
    assert api.post(f"/applications/{history['id']}/cancel").json()["code"] == "INVALID_STATUS"
    assert api.post(f"/applications/{history['id']}/offer/accept").json()["code"] == "INVALID_STATUS"
    with api.database.session() as session:
        db = Db(session)
        record = db.find_application(history["id"], lock=True)
        with pytest.raises(TransitionError):
            set_status(db, record, "APPROVED", api.clock(), SYSTEM, "Попытка вернуть одобрение")
    assert api.ok(api.get(f"/applications/{history['id']}"))["status"] == "DISBURSED"


def test_data_survives_restart(api: Api) -> None:
    api.login("client1@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 2_000_000, 24)
    api.ok(api.post(f"/applications/{app['id']}/submit"))
    token = api.headers
    with TestClient(create_app()) as restarted:
        response = restarted.get(f"/api/applications/{app['id']}", headers=token)
        assert response.status_code == 200 and response.json()["status"] == "SUBMITTED"
        listed = restarted.get("/api/applications", headers=token).json()
        assert len(listed) == 3


def test_health_live_and_ready(api: Api) -> None:
    assert api.ok(api.get("/health/live")) == {"status": "ok"}
    ready = api.ok(api.get("/health/ready"))
    assert ready["status"] == "ok" and ready["queue_due"] == 0
    assert ready["checks"] == {"database": "ok", "migrations": "ok", "pipeline": "ok", "assistant": "disabled"}

    api.login("client1@demo.local")
    draft = api.fill_draft("WORKING_CAPITAL", 2_000_000, 24)
    api.ok(api.post(f"/applications/{draft['id']}/submit"))
    api.clock.advance(60)
    lagging = api.ok(api.get("/health/ready"))
    assert lagging["status"] == "degraded" and lagging["checks"]["pipeline"] == "lagging"
    assert lagging["queue_due"] == 1 and lagging["queue_lag_seconds"] >= 58


def test_login_rate_limit(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    statuses = [
        api.client.post("/api/auth/login", json={"email": "client1@demo.local", "password": "nope"}).status_code
        for _ in range(11)
    ]
    assert statuses[:10] == [401] * 10 and statuses[10] == 429
    limited = api.client.post("/api/auth/login", json={"email": "client1@demo.local", "password": "demo"})
    assert limited.json()["code"] == "RATE_LIMITED" and int(limited.headers["Retry-After"]) >= 1
    assert api.client.post("/api/demo/reset").status_code == 204
    assert (
        api.client.post("/api/auth/login", json={"email": "client1@demo.local", "password": "demo"}).status_code == 200
    )


def test_correlation_id_in_headers_and_errors(api: Api) -> None:
    response = api.client.get("/api/auth/me", headers={"X-Request-ID": "trace-42"})
    assert response.status_code == 401 and response.headers["X-Request-ID"] == "trace-42"
    assert response.json()["correlation_id"] == "trace-42"
    generated = api.client.get("/api/health")
    assert len(generated.headers["X-Request-ID"]) == 32
    invalid = api.client.post("/api/auth/login", json={"email": 5})
    assert invalid.status_code == 422 and invalid.json()["field_errors"][0]["field"] == "email"


def test_worker_skips_locked_application(api: Api) -> None:
    api.login("client1@demo.local")
    draft = api.fill_draft("WORKING_CAPITAL", 2_000_000, 24)
    api.ok(api.post(f"/applications/{draft['id']}/submit"))
    api.clock.advance(3)
    with api.database.session() as holder:
        assert Db(holder).find_application(draft["id"], lock=True) is not None
        with api.database.session() as rival:
            assert Db(rival).next_due(api.clock()) is None
    assert api.advance(0) == 1
    assert api.ok(api.get(f"/applications/{draft['id']}"))["status"] == "VALIDATING"
