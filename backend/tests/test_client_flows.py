from tests.conftest import Api

SEEDED_CODES = [
    "OVERDRAFT",
    "WORKING_CAPITAL",
    "CREDIT_LINE",
    "EQUIPMENT",
    "LEASING",
    "INVESTMENT",
    "COMMERCIAL_MORTGAGE",
    "GOV_CONTRACT",
    "SUBSIDIZED",
    "REFINANCING",
]


def test_health_config_and_auth(api: Api) -> None:
    assert api.ok(api.get("/health")) == {"status": "ok"}
    config = api.ok(api.get("/config"))
    assert config["assistant_enabled"] is False
    assert [product["code"] for product in config["products"]] == SEEDED_CODES

    assert api.get("/auth/me").json()["code"] == "UNAUTHORIZED"
    bad = api.client.post("/api/auth/login", json={"email": "client1@demo.local", "password": "nope"})
    assert bad.status_code == 401 and bad.json()["code"] == "INVALID_CREDENTIALS"

    user = api.login("  Client1@demo.local ")
    assert user["company_id"] == "c-client1" and "password_hash" not in user
    assert api.ok(api.get("/auth/me"))["email"] == "client1@demo.local"
    assert api.get("/bank/stats").json()["code"] == "FORBIDDEN"


def test_client1_approved_signed_disbursed(api: Api) -> None:
    api.login("client1@demo.local")
    seeded = api.ok(api.get("/applications"))
    assert {item["status"] for item in seeded} == {"DRAFT", "DISBURSED"}

    app = api.fill_draft("WORKING_CAPITAL", 2_000_000, 24)
    submitted = api.ok(api.post(f"/applications/{app['id']}/submit"))
    assert submitted["status"] == "SUBMITTED"

    api.clock.advance(2.5)
    assert api.ok(api.get(f"/applications/{app['id']}"))["status"] == "VALIDATING"

    approved = api.wait(app["id"])
    assert approved["status"] == "APPROVED"
    assert approved["offer"]["rate"] == 19.5 and approved["offer"]["is_counter"] is False
    assert approved["contract"]["number"] == f"ДК-{app['number'].replace('КР-', '')}"

    contract = api.ok(api.get(f"/applications/{app['id']}/contract"))
    assert "2 000 000 ₽" in contract["html"] and "19,5% годовых" in contract["html"]

    assert api.ok(api.post(f"/applications/{app['id']}/sign")) == {"confirmation_code": "4821"}
    assert api.ok(api.post(f"/applications/{app['id']}/sign"))["confirmation_code"] == "4821"
    wrong = api.post(f"/applications/{app['id']}/sign/confirm", json={"code": "1111"})
    assert wrong.status_code == 400 and wrong.json()["code"] == "INVALID_CODE"
    signed = api.ok(api.post(f"/applications/{app['id']}/sign/confirm", json={"code": "4821"}))
    assert signed["status"] == "SIGNED" and signed["contract"]["signed_at"]

    disbursed = api.wait(app["id"], 3.5)
    assert disbursed["status"] == "DISBURSED"
    schedule = api.ok(api.get(f"/applications/{app['id']}/schedule"))
    assert len(schedule) == 24 and schedule[-1]["balance"] == 0
    assert sum(row["principal"] for row in schedule) in range(1_999_990, 2_000_011)

    statuses = [event["to_status"] for event in api.ok(api.get(f"/applications/{app['id']}/events"))]
    assert statuses == ["DRAFT", "SUBMITTED", "APPROVED", "SIGNING", "SIGNED", "DISBURSED"]
    decision = approved["decision"]
    assert decision["made_by"] == "SYSTEM"
    assert decision["reasons"] and not any("скоринг" in reason.lower() for reason in decision["reasons"])
    kinds = {item["type"] for item in api.ok(api.get("/notifications", params={"unread": "true"}))}
    assert {"APPLICATION_SUBMITTED", "STAGE_PASSED", "DECISION_MADE", "CONTRACT_READY", "DISBURSED"} <= kinds
    loans = api.ok(api.get("/company/insights"))["loans"]
    assert any(loan["id"] == app["id"] for loan in loans)


def test_client1_large_amount_goes_to_manual_review(api: Api) -> None:
    api.login("client1@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 6_000_000, 24)
    api.ok(api.post(f"/applications/{app['id']}/submit"))
    assert api.wait(app["id"])["status"] == "MANUAL_REVIEW"


def test_client2_counter_offer_and_markup(api: Api) -> None:
    api.login("client2@demo.local")
    big = api.fill_draft("WORKING_CAPITAL", 2_000_000, 12)
    api.ok(api.post(f"/applications/{big['id']}/submit"))
    offered = api.wait(big["id"])
    assert offered["status"] == "COUNTER_OFFER"
    assert offered["offer"]["amount"] == 1_000_000 and offered["offer"]["rate"] == 20.5
    assert offered["offer"]["requested"]["amount"] == 2_000_000

    accepted = api.ok(api.post(f"/applications/{big['id']}/offer/accept"))
    assert accepted["status"] == "APPROVED" and accepted["amount"] == 1_000_000

    small = api.fill_draft("WORKING_CAPITAL", 800_000, 12)
    api.ok(api.post(f"/applications/{small['id']}/submit"))
    approved = api.wait(small["id"])
    assert approved["status"] == "APPROVED" and approved["offer"]["rate"] == 21.5


def test_client4_rejected_with_reasons(api: Api) -> None:
    api.login("client4@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 1_000_000, 12)
    api.ok(api.post(f"/applications/{app['id']}/submit"))
    rejected = api.wait(app["id"])
    assert rejected["status"] == "REJECTED"
    assert rejected["decision"]["reasons"] == [
        "Просрочка по кредитам свыше 180 дней",
        "Налоговая задолженность 312 000 ₽",
    ]
    assert api.ok(api.get("/company/insights"))["pre_approved_limit"] == 0


def test_client5_need_info_then_approved(api: Api) -> None:
    api.login("client5@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 1_500_000, 12)
    api.ok(api.post(f"/applications/{app['id']}/submit"))
    need = api.wait(app["id"])
    assert need["status"] == "NEED_INFO"
    request = need["info_request"]
    assert [item["code"] for item in request["items"]] == ["revenue_12m", "statement_6m"]

    upload = api.post(
        f"/applications/{app['id']}/documents",
        data={"kind": "BANK_STATEMENT"},
        files={"file": ("vypiska-6m.pdf", b"%PDF-1.4 demo", "application/pdf")},
    )
    document = api.ok(upload, 201)
    assert document["filename"] == "vypiska-6m.pdf" and document["size"] == 13

    incomplete = api.post(f"/applications/{app['id']}/info-requests/{request['id']}/respond", json={"answers": []})
    assert incomplete.status_code == 422 and incomplete.json()["missing"]
    not_number = api.post(
        f"/applications/{app['id']}/info-requests/{request['id']}/respond",
        json={
            "answers": [{"code": "revenue_12m", "value": "много"}, {"code": "statement_6m", "value": document["id"]}]
        },
    )
    assert not_number.status_code == 422

    answered = api.ok(
        api.post(
            f"/applications/{app['id']}/info-requests/{request['id']}/respond",
            json={
                "answers": [
                    {"code": "revenue_12m", "value": "41 000 000"},
                    {"code": "statement_6m", "value": document["id"]},
                ]
            },
        )
    )
    assert answered["status"] == "SUBMITTED" and answered["financials"]["revenue_12m"] == 41_000_000
    approved = api.wait(answered["id"])
    assert approved["status"] == "APPROVED" and approved["offer"]["rate"] == 20


def test_equipment_requires_invoice(api: Api) -> None:
    api.login("client2@demo.local")
    app = api.fill_draft("EQUIPMENT", 600_000, 24, "EQUIPMENT")
    response = api.post(f"/applications/{app['id']}/submit")
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "INCOMPLETE" and body["missing"] == ["equipment_invoice"]

    document = api.ok(
        api.post(
            f"/applications/{app['id']}/documents",
            data={"kind": "EQUIPMENT_INVOICE"},
            files={"file": ("schet.pdf", b"invoice", "application/pdf")},
        ),
        201,
    )
    assert api.ok(api.post(f"/applications/{app['id']}/submit"))["status"] == "SUBMITTED"
    locked = api.delete(f"/applications/{app['id']}/documents/{document['id']}")
    assert locked.status_code == 409


def test_draft_patch_rules(api: Api) -> None:
    api.login("client1@demo.local")
    draft = api.ok(api.post("/applications", json={"product_code": "OVERDRAFT", "amount": 99_000_000, "term": 99}), 201)
    assert draft["amount"] == 5_000_000 and draft["term"] == 12 and draft["purpose_type"] == "CASH_GAP"
    assert api.post("/applications", json={"product_code": "NOPE"}).json()["code"] == "UNKNOWN_PRODUCT"

    patched = api.ok(api.patch(f"/applications/{draft['id']}", json={"product_code": "EQUIPMENT"}))
    assert patched["product"]["code"] == "EQUIPMENT" and patched["purpose_type"] == "EQUIPMENT"
    assert patched["amount"] == 5_000_000 and patched["term"] == 12
    cleared = api.ok(api.patch(f"/applications/{draft['id']}", json={"purpose_type": None, "consents": {"bki": True}}))
    assert cleared["purpose_type"] is None and cleared["consents"] == {
        "bki": True,
        "personal_data": False,
        "risks": False,
    }
    invalid = api.patch(f"/applications/{draft['id']}", json={"financials": "много"})
    assert invalid.status_code == 422 and invalid.json()["code"] == "VALIDATION"

    cancelled = api.ok(api.post(f"/applications/{draft['id']}/cancel"))
    assert cancelled["status"] == "CANCELLED"
    assert api.patch(f"/applications/{draft['id']}", json={"amount": 1}).json()["code"] == "NOT_EDITABLE"

    api.login("client3@demo.local")
    assert api.get(f"/applications/{draft['id']}").status_code == 404


def test_mock_fail_slows_enrichment(api: Api) -> None:
    api.login("client1@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 1_000_000, 12)
    api.ok(api.post(f"/applications/{app['id']}/submit", params={"mock_fail": 1}))
    api.clock.advance(6.5)
    assert api.ok(api.get(f"/applications/{app['id']}"))["status"] == "ENRICHING"
    client_reasons = [event["reason"] for event in api.ok(api.get(f"/applications/{app['id']}/events"))]
    assert "Бюро кредитных историй не ответило — повторный запрос в БКИ" not in client_reasons
    api.login("underwriter@bank.local")
    reasons = [event["reason"] for event in api.ok(api.get(f"/bank/applications/{app['id']}/events"))]
    assert "Бюро кредитных историй не ответило — повторный запрос в БКИ" in reasons
    api.login("client1@demo.local")
    assert api.wait(app["id"], 10)["status"] == "APPROVED"


def test_client6_onboarding(api: Api) -> None:
    user = api.login("client6@demo.local")
    assert user["company_id"] is None
    assert api.get("/company").json()["code"] == "NO_COMPANY"
    assert api.get("/company/insights").status_code == 404
    assert api.post("/applications", json={"product_code": "WORKING_CAPITAL"}).json()["code"] == "NO_COMPANY"

    assert api.get("/company/lookup", params={"inn": "123"}).json()["code"] == "INVALID_INN"
    assert api.get("/company/lookup", params={"inn": "0000000000"}).status_code == 404
    taken = api.post("/company", json={"inn": "7714382915"})
    assert taken.status_code == 409 and taken.json()["code"] == "ALREADY_LINKED"

    found = api.ok(api.get("/company/lookup", params={"inn": "7714 0528 3916"}))
    assert found["name"] == "ИП Петров П.С." and "id" not in found
    linked = api.ok(api.post("/company", json={"inn": "771405283916"}))
    assert linked["id"] == "c-registry-petrov"
    assert api.ok(api.get("/auth/me"))["company_id"] == "c-registry-petrov"
    assert api.post("/company", json={"inn": "771405283916"}).json()["code"] == "COMPANY_EXISTS"
    insights = api.ok(api.get("/company/insights"))
    assert insights == {"turnover": [], "avg_free_cash_flow": 0, "pre_approved_limit": 0, "loans": []}


def test_notifications_read(api: Api) -> None:
    api.login("client3@demo.local")
    unread = api.ok(api.get("/notifications", params={"unread": "true"}))
    assert len(unread) == 1
    assert api.post(f"/notifications/{unread[0]['id']}/read").status_code == 204
    assert api.ok(api.get("/notifications", params={"unread": "true"})) == []
    assert len(api.ok(api.get("/notifications", params={"limit": 1}))) == 1
    assert api.post("/notifications/read-all").status_code == 204
    assert api.post("/notifications/unknown/read").status_code == 404


def test_subsidized_only_for_priority_industries(api: Api) -> None:
    api.login("client2@demo.local")
    blocked = api.post("/applications", json={"product_code": "SUBSIDIZED", "amount": 1_000_000, "term": 12})
    assert blocked.status_code == 422 and blocked.json()["code"] == "PRODUCT_NOT_ELIGIBLE"
    draft = api.ok(api.post("/applications", json={"product_code": "WORKING_CAPITAL", "amount": 1_000_000, "term": 12}), 201)
    switched = api.patch(f"/applications/{draft['id']}", json={"product_code": "SUBSIDIZED"})
    assert switched.status_code == 422 and switched.json()["code"] == "PRODUCT_NOT_ELIGIBLE"

    api.login("client1@demo.local")
    app = api.ok(api.post("/applications", json={"product_code": "SUBSIDIZED", "amount": 1_000_000, "term": 12}), 201)
    assert app["product"]["base_rate"] == 10.5 and app["purpose_type"] == "WORKING_CAPITAL"
    assert app["product"]["category"] == "SPECIAL" and app["product"]["targeted"] is True
    mortgage = api.ok(api.post("/applications", json={"product_code": "COMMERCIAL_MORTGAGE", "amount": 20_000_000, "term": 999}), 201)
    assert mortgage["term"] == 180 and mortgage["purpose_type"] == "REAL_ESTATE"


def test_pre_approved_limit_counts_current_loans(api: Api) -> None:
    api.login("client1@demo.local")
    insights = api.ok(api.get("/company/insights"))
    current = sum(loan["monthly_payment"] for loan in insights["loans"])
    flow = insights["avg_free_cash_flow"] + current
    limit = insights["pre_approved_limit"]
    assert current > 0 and limit > 0
    monthly = 0.195 / 12
    payment = limit * monthly / (1 - (1 + monthly) ** -24)
    assert (current + payment) / flow <= 0.4

    api.login("client3@demo.local")
    assert api.ok(api.get("/company/insights"))["pre_approved_limit"] == 0


def test_overdraft_has_no_annuity_schedule(api: Api) -> None:
    api.login("client1@demo.local")
    overdraft = next(item for item in api.ok(api.get("/config"))["products"] if item["code"] == "OVERDRAFT")
    assert overdraft["repayment"] == "REVOLVING"
    app = api.fill_draft("OVERDRAFT", 1_200_000, 12, "CASH_GAP")
    api.ok(api.post(f"/applications/{app['id']}/submit"))
    approved = api.wait(app["id"])
    assert approved["status"] == "APPROVED"
    assert approved["offer"]["monthly_payment"] == 21_000
    contract = api.ok(api.get(f"/applications/{app['id']}/contract"))["html"]
    assert "Лимит овердрафта" in contract and "аннуитет" not in contract.replace("Графика аннуитетных платежей нет", "")
    assert api.ok(api.get(f"/applications/{app['id']}/schedule")) == []


def test_client_does_not_see_underwriter_or_internal_reasons(api: Api) -> None:
    api.login("client3@demo.local")
    review = next(item for item in api.ok(api.get("/applications")) if item["status"] == "MANUAL_REVIEW")
    detail = api.ok(api.get(f"/applications/{review['id']}"))
    assert detail["decision"] is None
    events = api.ok(api.get(f"/applications/{review['id']}/events"))
    assert {event["to_status"] for event in events}.isdisjoint({"VALIDATING", "ENRICHING", "SCORING", "DECIDING"})
    assert all("просрочк" not in (event["reason"] or "") for event in events)
    assert all(event["actor_name"] in ("", detail["company"]["head_name"]) or event["actor_type"] == "CLIENT" for event in events)

    api.login("underwriter@bank.local")
    api.ok(api.post(f"/bank/applications/{review['id']}/assign"))
    api.ok(
        api.post(
            f"/bank/applications/{review['id']}/decision",
            json={"type": "COUNTER_OFFER", "amount": 2_800_000, "term": 24, "rate": 21.5, "comment": "Меньшая сумма"},
        )
    )
    api.login("client3@demo.local")
    countered = api.ok(api.get(f"/applications/{review['id']}"))
    assert countered["decision"]["made_by"] == "Специалист банка"
    names = {event["actor_name"] for event in api.ok(api.get(f"/applications/{review['id']}/events"))}
    assert "Ковалёва Ирина Михайловна" not in names
