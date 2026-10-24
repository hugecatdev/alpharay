from tests.conftest import Api


def client3_review_id(api: Api) -> str:
    api.login("underwriter@bank.local")
    queue = api.ok(api.get("/bank/applications", params={"status": "MANUAL_REVIEW"}))
    return next(item["id"] for item in queue if "СтройМастер" in item["company_name"])


def test_queue_card_and_stats(api: Api) -> None:
    api.login("underwriter@bank.local")
    queue = api.ok(api.get("/bank/applications", params={"status": "MANUAL_REVIEW"}))
    assert {item["company_name"] for item in queue} == {"ООО «СтройМастер»", "ООО «Северный Мёд»", "ИП Гарипова Л.Р."}
    assert [item["waiting_since"] for item in queue] == sorted(item["waiting_since"] for item in queue)
    mine = api.ok(api.get("/bank/applications", params={"assigned": "me"}))
    assert {item["company_name"] for item in mine} == {
        "ООО «Северный Мёд»",
        "ООО «Апельсин Медиа»",
        "ООО «Логистик-Юг»",
    }
    everything = api.ok(api.get("/bank/applications"))
    assert len(everything) == 8 and all(item["status"] != "DRAFT" for item in everything)

    card = api.ok(api.get(f"/bank/applications/{client3_review_id(api)}"))
    assert card["enrichment"]["bki"]["max_overdue_days_24m"] == 45
    assert [check["type"] for check in card["checks"]] == ["COMPLETENESS", "EGRUL", "FNS", "ACCOUNT", "BKI"]
    assert [revision["reason"] for revision in card["revisions"]] == ["SUBMITTED"]
    assert card["decision"]["reason_codes"] == ["OVERDUE_HISTORY"]
    assert card["scoring"]["model_version"] == "rules-v1.2" and len(card["scoring"]["factors"]) == 7
    assert set(card["recommendation"]) <= {"type", "amount", "term", "rate", "reasons"}

    green = next(item for item in everything if item["company_name"] == "ООО «Зелёный Квартал»")
    green_card = api.ok(api.get(f"/bank/applications/{green['id']}"))
    assert green_card["scoring"]["grade"] == "D" and green_card["status"] == "REJECTED"
    assert green_card["recommendation"] == {"type": "REJECTED", "reasons": green_card["scoring"]["stop_factors"]}

    stats = api.ok(api.get("/bank/stats"))
    assert stats["total"] == 8
    assert stats["funnel"][0]["status"] == "SUBMITTED" and len(stats["funnel"]) == 17
    assert 0 < stats["auto_decision_share"] < 1 and stats["avg_review_hours"] > 0


def test_auto_decision_share_counts_completed_reviews_without_staff(api: Api) -> None:
    api.login("underwriter@bank.local")
    assert api.ok(api.get("/bank/stats"))["auto_decision_share"] == 0.75

    api.login("client1@demo.local")
    app = api.fill_draft("WORKING_CAPITAL", 1_000_000, 12)
    api.ok(api.post(f"/applications/{app['id']}/submit", params={"mock_fail": 2}))
    assert api.wait(app["id"], 20)["status"] == "MANUAL_REVIEW"

    api.login("underwriter@bank.local")
    api.ok(api.post(f"/bank/applications/{app['id']}/assign"))
    api.ok(api.post(f"/bank/applications/{app['id']}/decision", json={"type": "NEED_INFO", "items": ["revenue_12m"]}))
    assert api.ok(api.get("/bank/stats"))["auto_decision_share"] == 0.75

    api.login("client1@demo.local")
    request = api.ok(api.get(f"/applications/{app['id']}"))["info_request"]
    answer = {"code": "revenue_12m", "value": str(app["financials"]["revenue_12m"])}
    api.ok(api.post(f"/applications/{app['id']}/info-requests/{request['id']}/respond", json={"answers": [answer]}))
    assert api.wait(app["id"])["status"] == "APPROVED"

    api.login("underwriter@bank.local")
    assert api.ok(api.get("/bank/stats"))["auto_decision_share"] == 0.6


def test_counter_offer_by_underwriter_then_client_accepts(api: Api) -> None:
    review_id = client3_review_id(api)
    assigned = api.ok(api.post(f"/bank/applications/{review_id}/assign"))
    assert assigned["assigned_to"] == "Ковалёва Ирина Михайловна"

    missing_terms = api.post(f"/bank/applications/{review_id}/decision", json={"type": "COUNTER_OFFER", "comment": ""})
    assert missing_terms.status_code == 422
    out_of_range = api.post(
        f"/bank/applications/{review_id}/decision",
        json={"type": "COUNTER_OFFER", "amount": 100, "term": 12, "rate": 21, "comment": ""},
    )
    assert out_of_range.status_code == 422

    decided = api.ok(
        api.post(
            f"/bank/applications/{review_id}/decision",
            json={
                "type": "COUNTER_OFFER",
                "amount": 3_000_000,
                "term": 24,
                "rate": 21.5,
                "comment": "Предлагаем меньшую сумму с учётом текущей нагрузки",
            },
        )
    )
    assert decided["status"] == "COUNTER_OFFER"
    assert decided["decision"]["reasons"] == ["Предлагаем меньшую сумму с учётом текущей нагрузки"]
    again = api.post(f"/bank/applications/{review_id}/decision", json={"type": "APPROVED", "comment": ""})
    assert again.status_code == 409

    api.login("client3@demo.local")
    offers = [item for item in api.ok(api.get("/notifications")) if item["type"] == "OFFER_PENDING"]
    assert offers and offers[0]["application_id"] == review_id
    accepted = api.ok(api.post(f"/applications/{review_id}/offer/accept"))
    assert accepted["status"] == "OFFER_ACCEPTED" and accepted["amount"] == 3_000_000

    api.login("underwriter@bank.local")
    events = api.ok(api.get(f"/bank/applications/{review_id}/events"))
    assert [event["actor_type"] for event in events][-2:] == ["UNDERWRITER", "CLIENT"]


def test_accountant_signs_with_head_certificate(api: Api) -> None:
    review_id = client3_review_id(api)
    api.ok(api.post(f"/bank/applications/{review_id}/decision", json={"type": "APPROVED", "comment": ""}))

    api.login("client3@demo.local")
    company = api.ok(api.get("/company"))
    api.ok(api.post(f"/applications/{review_id}/offer/accept"))
    api.ok(api.post(f"/applications/{review_id}/sign"))
    certificates = api.ok(api.get(f"/applications/{review_id}/sign/certificates"))
    valid = [item for item in certificates if item["problem"] is None]
    assert len(valid) == 1 and valid[0]["owner_name"] == company["head_name"]
    signed = api.ok(api.post(f"/applications/{review_id}/sign/kep", json={"certificate_id": valid[0]["id"]}))
    assert signed["status"] == "SIGNED" and signed["contract"]["certificate"]["owner_name"] == company["head_name"]


def test_need_info_and_reject_validation(api: Api) -> None:
    review_id = client3_review_id(api)
    empty = api.post(f"/bank/applications/{review_id}/decision", json={"type": "NEED_INFO", "items": []})
    assert empty.status_code == 422
    no_reason = api.post(f"/bank/applications/{review_id}/decision", json={"type": "REJECTED", "comment": ""})
    assert no_reason.status_code == 422
    unknown = api.post(f"/bank/applications/{review_id}/decision", json={"type": "MANUAL_REVIEW"})
    assert unknown.status_code == 422

    decided = api.ok(
        api.post(
            f"/bank/applications/{review_id}/decision",
            json={"type": "NEED_INFO", "items": ["overdue_explanation", "custom"], "comment": "Поясните просрочку"},
        )
    )
    assert decided["info_request"]["items"] == [
        {"code": "overdue_explanation", "label": "Пояснение по просрочке", "type": "text"},
        {"code": "custom", "label": "custom", "type": "text"},
    ]


def test_demo_reset(api: Api) -> None:
    api.login("client1@demo.local")
    draft = api.ok(api.post("/applications", json={"product_code": "OVERDRAFT"}), 201)
    assert api.client.post("/api/demo/reset").status_code == 204
    assert api.get(f"/applications/{draft['id']}").status_code == 404
