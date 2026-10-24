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


def policy_payload(api: Api, **changes) -> dict:
    current = api.ok(api.get("/admin/policy"))
    current.pop("updated_at")
    current.pop("updated_by")
    current.update(changes)
    return current


def stroymaster_id(api: Api) -> str:
    queue = api.ok(api.get("/bank/applications", params={"status": "MANUAL_REVIEW"}))
    return next(item["id"] for item in queue if "СтройМастер" in item["company_name"])


def test_admin_access(api: Api) -> None:
    api.login("client1@demo.local")
    assert api.get("/admin/dashboard").status_code == 403
    api.login("underwriter@bank.local")
    assert api.get("/admin/dashboard").status_code == 403
    user = api.login("admin@bank.local")
    assert user["role"] == "ADMIN"
    assert api.get("/admin/dashboard").status_code == 200
    assert len(api.ok(api.get("/bank/applications"))) == 8
    assert api.get("/applications").status_code == 403


def test_dashboard(api: Api) -> None:
    api.login("admin@bank.local")
    board = api.ok(api.get("/admin/dashboard"))
    totals = board["totals"]
    assert totals["applications"] == 9 and totals["drafts"] == 1 and totals["manual_review"] == 3
    assert totals["awaiting_client"] == 2 and totals["rejected"] == 1
    assert totals["disbursed_count"] == 2 and totals["disbursed_amount"] == 13_500_000
    assert board["approval_rate"] == 0.75 and board["auto_decision_share"] == 0.75
    assert board["avg_manual_review_hours"] == 6 and board["avg_time_to_decision_minutes"] > 0
    assert len(board["funnel"]) == 17 and [item["code"] for item in board["by_product"]] == SEEDED_CODES
    staff = {item["id"]: item for item in board["underwriters"]}
    assert staff["u-underwriter"]["decisions"] == 2 and staff["u-underwriter"]["active_reviews"] == 1
    assert staff["u-underwriter2"]["active_reviews"] == 1 and staff["u-admin"]["role"] == "ADMIN"
    assert [item["company_name"] for item in board["sla_breaches"]] == ["ООО «Северный Мёд»"]
    assert api.ok(api.get("/admin/dashboard", params={"days": 1}))["totals"]["applications"] == 2


def test_reassign_and_audit(api: Api) -> None:
    api.login("admin@bank.local")
    review = stroymaster_id(api)
    assigned = api.ok(api.post(f"/admin/applications/{review}/assign", json={"assignee_id": "u-underwriter2"}))
    assert assigned["assignee_id"] == "u-underwriter2" and assigned["assigned_to"] == "Белов Максим Олегович"
    rows = api.ok(api.get("/admin/applications", params={"assignee_id": "u-underwriter2"}))
    assert {row["id"] for row in rows} >= {review}
    assert all(row["assignee_id"] == "u-underwriter2" for row in rows)
    assert (
        api.ok(api.get("/admin/applications", params={"sla_breached": "true"}))[0]["company_name"]
        == "ООО «Северный Мёд»"
    )
    assert api.ok(api.get("/admin/applications", params={"q": "5260417832"}))[0]["id"] == review

    assert api.post(f"/admin/applications/{review}/assign", json={"assignee_id": "u-client1"}).status_code == 422
    history = next(row for row in api.ok(api.get("/admin/applications", params={"status": "DISBURSED"})))
    assert api.post(f"/admin/applications/{history['id']}/assign", json={"assignee_id": None}).status_code == 409

    api.login("underwriter2@bank.local")
    mine = api.ok(api.get("/bank/applications", params={"assigned": "me"}))
    assert review in {item["id"] for item in mine}

    api.login("admin@bank.local")
    released = api.ok(api.post(f"/admin/applications/{review}/assign", json={"assignee_id": None}))
    assert released["assignee_id"] is None and released["assigned_to"] is None
    entries = api.ok(api.get("/admin/audit", params={"entity_id": review}))
    assert [entry["summary"] for entry in entries][:2] == [
        f"Заявка {released['number']} возвращена в общую очередь",
        f"Заявка {released['number']} назначена: Белов Максим Олегович",
    ]
    assert entries[0]["actor_role"] == "ADMIN"


def test_staff_management(api: Api) -> None:
    api.login("admin@bank.local")
    assert api.post("/admin/staff", json={"email": "bad", "full_name": "Х", "password": "secret1"}).status_code == 422
    taken = api.post("/admin/staff", json={"email": "underwriter@bank.local", "full_name": "Х", "password": "secret1"})
    assert taken.status_code == 409
    short = api.post("/admin/staff", json={"email": "new@bank.local", "full_name": "Новиков Н.Н.", "password": "123"})
    assert short.status_code == 422

    created = api.ok(
        api.post(
            "/admin/staff",
            json={"email": " New@Bank.local ", "full_name": "Новиков Николай Николаевич", "password": "secret1"},
        ),
        201,
    )
    assert created["email"] == "new@bank.local" and created["role"] == "UNDERWRITER" and created["active"]
    review = stroymaster_id(api)
    api.ok(api.post(f"/admin/applications/{review}/assign", json={"assignee_id": created["id"]}))

    newcomer = api.client.post("/api/auth/login", json={"email": "new@bank.local", "password": "secret1"})
    token = {"Authorization": f"Bearer {newcomer.json()['access_token']}"}
    assert api.client.get("/api/bank/applications", headers=token).status_code == 200

    blocked = api.ok(api.patch(f"/admin/staff/{created['id']}", json={"active": False}))
    assert blocked["active"] is False and blocked["active_reviews"] == 0
    assert api.client.get("/api/bank/applications", headers=token).status_code == 401
    denied = api.client.post("/api/auth/login", json={"email": "new@bank.local", "password": "secret1"})
    assert denied.status_code == 403 and denied.json()["code"] == "ACCOUNT_DISABLED"
    card = api.ok(api.get(f"/bank/applications/{review}"))
    assert card["assignee_id"] is None

    assert api.patch("/admin/staff/u-admin", json={"active": False}).json()["code"] == "SELF_LOCKOUT"
    assert api.patch("/admin/staff/u-admin", json={"role": "UNDERWRITER"}).json()["code"] == "SELF_LOCKOUT"
    assert api.patch("/admin/staff/u-client1", json={"active": False}).status_code == 404
    promoted = api.ok(api.patch("/admin/staff/u-underwriter2", json={"role": "ADMIN", "position": "Заместитель"}))
    assert promoted["role"] == "ADMIN"
    actions = [entry["action"] for entry in api.ok(api.get("/admin/audit", params={"entity_type": "staff"}))]
    assert actions == ["staff.update", "staff.update", "staff.create"]


def test_products_admin(api: Api) -> None:
    api.login("admin@bank.local")
    product = {
        "code": "tender",
        "name": "Тендерный кредит",
        "description": "Обеспечение участия в госзакупках",
        "min_amount": 200_000,
        "max_amount": 10_000_000,
        "min_term": 2,
        "max_term": 18,
        "base_rate": 21,
        "purpose_types": ["WORKING_CAPITAL"],
    }
    assert api.post("/admin/products", json={**product, "code": "x"}).status_code == 422
    assert api.post("/admin/products", json={**product, "min_amount": 20_000_000}).status_code == 422
    created = api.ok(api.post("/admin/products", json=product), 201)
    assert created["code"] == "TENDER" and created["active"] and created["applications_total"] == 0
    assert api.post("/admin/products", json=product).status_code == 409

    updated = api.ok(api.patch("/admin/products/TENDER", json={"base_rate": 20.5}))
    assert updated["base_rate"] == 20.5
    assert api.patch("/admin/products/NOPE", json={"active": False}).status_code == 404
    api.ok(api.patch("/admin/products/WORKING_CAPITAL", json={"active": False}))
    api.ok(api.patch("/admin/products/EQUIPMENT", json={"active": False}))

    api.login("client1@demo.local")
    codes = [item["code"] for item in api.ok(api.get("/config"))["products"]]
    assert codes == [code for code in SEEDED_CODES if code not in {"WORKING_CAPITAL", "EQUIPMENT"}] + ["TENDER"]
    tender = api.ok(api.post("/applications", json={"product_code": "TENDER", "amount": 1_000_000, "term": 12}), 201)
    assert tender["product"]["base_rate"] == 20.5
    assert api.post("/applications", json={"product_code": "WORKING_CAPITAL"}).json()["code"] == "UNKNOWN_PRODUCT"
    draft = next(item for item in api.ok(api.get("/applications")) if item["product_code"] == "EQUIPMENT")
    blocked = api.post(f"/applications/{draft['id']}/submit")
    assert blocked.status_code == 422 and "product" in blocked.json()["missing"]

    api.login("admin@bank.local")
    for code in SEEDED_CODES:
        api.ok(api.patch(f"/admin/products/{code}", json={"active": False}))
    assert api.patch("/admin/products/TENDER", json={"active": False}).json()["code"] == "LAST_PRODUCT"
    summaries = [entry["summary"] for entry in api.ok(api.get("/admin/audit", params={"entity_type": "product"}))]
    assert "Продукт «Тендерный кредит»: ставка" in summaries and "Добавлен продукт «Тендерный кредит»" in summaries


def test_policy_validation_and_threshold(api: Api) -> None:
    api.login("admin@bank.local")
    defaults = api.ok(api.get("/admin/policy"))
    assert (
        defaults["manual_review_amount_threshold"] == 5_000_000
        and defaults["grades"]["C"]["auto_decision"] == "MANUAL_REVIEW"
    )

    broken = policy_payload(api)
    broken["grades"]["B"]["min_score"] = 90
    assert api.client.put("/api/admin/policy", headers=api.headers, json=broken).status_code == 422
    unknown = policy_payload(api, product_review_thresholds={"NOPE": 1})
    assert api.client.put("/api/admin/policy", headers=api.headers, json=unknown).status_code == 422
    out_of_range = policy_payload(api, counter_offer_share=5)
    assert api.client.put("/api/admin/policy", headers=api.headers, json=out_of_range).status_code == 422

    saved = api.ok(
        api.client.put(
            "/api/admin/policy", headers=api.headers, json=policy_payload(api, manual_review_amount_threshold=1_000_000)
        )
    )
    assert saved["updated_by"] == "Захарова Елена Викторовна"
    assert api.ok(api.get("/config"))["manual_review_amount_threshold"] == 1_000_000
    entry = api.ok(api.get("/admin/audit", params={"entity_type": "policy"}))[0]
    assert entry["summary"] == "Версия 2: порог ручного рассмотрения 5 000 000 ₽ → 1 000 000 ₽"
    assert api.ok(api.get("/admin/policy"))["version"] == 2

    api.login("client1@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 2_000_000, 24)
    api.ok(api.post(f"/applications/{app['id']}/submit"))
    assert api.wait(app["id"])["status"] == "MANUAL_REVIEW"


def test_policy_drives_generic_decisions(api: Api) -> None:
    api.login("admin@bank.local")
    grades = {
        grade: {"min_score": score, "auto_decision": "COUNTER_OFFER", "rate_markup": 3}
        for grade, score in zip("ABCD", (75, 60, 45, 0), strict=True)
    }
    api.ok(
        api.client.put(
            "/api/admin/policy",
            headers=api.headers,
            json=policy_payload(api, grades=grades, counter_offer_share=0.5, offer_valid_days=3),
        )
    )
    api.login("client1@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 1_000_000, 12)
    api.ok(api.post(f"/applications/{app['id']}/submit"))
    offered = api.wait(app["id"])
    assert offered["status"] == "COUNTER_OFFER"
    assert offered["offer"]["amount"] == 500_000 and offered["offer"]["rate"] == 22.5
    assert offered["decision"]["reasons"] == ["Условия скорректированы по кредитной политике банка"]
    assert offered["offer"]["valid_until"] < "9999" and offered["offer"]["valid_until"].startswith("2026-10-24")


def test_manual_disbursement_and_auto_assign(api: Api) -> None:
    api.login("admin@bank.local")
    api.ok(
        api.client.put(
            "/api/admin/policy",
            headers=api.headers,
            json=policy_payload(api, auto_disbursement=False, auto_assign=True),
        )
    )

    api.login("client1@demo.local")
    app = api.approved(amount=1_000_000, term=12)
    api.ok(api.post(f"/applications/{app['id']}/offer/accept"))
    api.ok(api.post(f"/applications/{app['id']}/sign"))
    api.ok(api.post(f"/applications/{app['id']}/sign/confirm", json={"code": "4821"}))
    assert api.wait(app["id"], 30)["status"] == "SIGNED"

    api.login("client3@demo.local")
    review = api.fill_draft("WORKING_CAPITAL", 1_000_000, 12)
    api.ok(api.post(f"/applications/{review['id']}/submit"))
    assert api.wait(review["id"])["status"] == "MANUAL_REVIEW"

    api.login("underwriter@bank.local")
    disbursed = api.ok(api.post(f"/bank/applications/{app['id']}/disburse"))
    assert disbursed["status"] == "DISBURSED"
    assert api.post(f"/bank/applications/{app['id']}/disburse").status_code == 409
    card = api.ok(api.get(f"/bank/applications/{review['id']}"))
    assert card["assignee_id"] == "u-underwriter2"

    api.login("client1@demo.local")
    assert api.ok(api.get(f"/applications/{app['id']}"))["status"] == "DISBURSED"

    api.login("admin@bank.local")
    entries = api.ok(api.get("/admin/audit"))
    disbursement = next(entry for entry in entries if entry["action"] == "application.disburse")
    assert disbursement["actor_name"] == "Ковалёва Ирина Михайловна" and disbursement["entity_id"] == app["id"]
    routed = next(
        entry for entry in entries if entry["action"] == "application.assign" and entry["entity_id"] == review["id"]
    )
    assert routed["actor_role"] == "SYSTEM" and routed["summary"].endswith("Белов Максим Олегович")


def test_notes(api: Api) -> None:
    api.login("underwriter@bank.local")
    review = stroymaster_id(api)
    assert api.post(f"/bank/applications/{review}/notes", json={"text": "  "}).status_code == 422
    note = api.ok(
        api.post(f"/bank/applications/{review}/notes", json={"text": "Запросить пояснение по просрочке"}), 201
    )
    assert note["author_name"] == "Ковалёва Ирина Михайловна"
    api.login("admin@bank.local")
    assert [item["text"] for item in api.ok(api.get(f"/bank/applications/{review}/notes"))] == [
        "Запросить пояснение по просрочке"
    ]
    api.login("client3@demo.local")
    assert api.get(f"/bank/applications/{review}/notes").status_code == 403
