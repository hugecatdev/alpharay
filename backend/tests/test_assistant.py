import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.assistant.agent import strip_echo
from app.assistant.llm import ChatClient
from app.config import settings
from tests.conftest import Api

CONTEXT = {
    "screen": "wizard.amount",
    "title": "Сумма и срок",
    "path": "/app/applications/new",
    "application_id": None,
    "data": {"product_code": "WORKING_CAPITAL", "amount": 3_000_000, "term": 24, "rate": 19.5},
}


def tool_call(call_id: str, name: str, arguments: dict) -> dict:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
    }


class FakeLlm:
    def __init__(self, replies: list[dict]) -> None:
        self.replies = replies
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/chat/completions")
        assert request.headers["Authorization"] == "Bearer test-key"
        self.requests.append(json.loads(request.content))
        if not self.replies:
            return httpx.Response(500, json={"error": "no more replies"})
        return httpx.Response(200, json={"choices": [{"message": self.replies.pop(0)}]})


@pytest.fixture
def llm_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_max_rounds", 3)


def use_fake(client: TestClient, fake: FakeLlm) -> None:
    client.app.state.llm = ChatClient(httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))


def test_assistant_hidden_without_key(api: Api) -> None:
    api.login("client1@demo.local")
    assert api.ok(api.get("/config"))["assistant_enabled"] is False
    response = api.post("/assistant/chat", json={"session_id": None, "message": "Привет", "context": CONTEXT})
    assert response.status_code == 503 and response.json()["code"] == "ASSISTANT_DISABLED"


def test_agent_rounds_with_tools(api: Api, llm_enabled: None) -> None:
    fake = FakeLlm(
        [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    tool_call("c1", "calc_loan", {"amount": 3_000_000, "term": 24}),
                    tool_call("c2", "get_company_overview", {}),
                ],
            },
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    tool_call(
                        "c3",
                        "show_hints",
                        {
                            "highlight": [
                                {"target": "risk-warning", "label": "Показать блок рисков"},
                                {"target": "company-card", "label": "Не с этого экрана"},
                            ],
                            "questions": ["Как снизить платёж?", "Что будет при просрочке?", "Как снизить платёж?"],
                        },
                    ),
                ],
            },
            {
                "role": "assistant",
                "content": "<think>считаю</think>**Платёж — 151 870 ₽ в месяц.** Оценка не является решением банка.",
            },
        ]
    )
    use_fake(api.client, fake)
    api.login("client1@demo.local")
    assert api.ok(api.get("/config"))["assistant_enabled"] is True

    reply = api.ok(
        api.post(
            "/assistant/chat", json={"session_id": None, "message": "Чем мне грозит этот кредит?", "context": CONTEXT}
        )
    )
    message = reply["message"]
    assert message["content"].startswith("**Платёж")
    assert message["hints"] == [{"target": "risk-warning", "label": "Показать блок рисков"}]
    assert message["suggestions"] == ["Как снизить платёж?", "Что будет при просрочке?"]

    first = fake.requests[0]
    assert first["model"] == settings.llm_model and first["tool_choice"] == "auto"
    assert {tool["function"]["name"] for tool in first["tools"]} >= {"calc_loan", "show_hints", "get_application"}
    system = first["messages"][0]["content"]
    assert "ООО «Пекарня Ветер»" in system and "wizard.amount" in system and "risk-warning" in system
    assert "Расчёт по экрану: 3 000 000 ₽ на 24 мес. под 19,5% — платёж 151 956 ₽" in system

    tool_results = {
        item["tool_call_id"]: json.loads(item["content"])
        for item in fake.requests[1]["messages"]
        if item["role"] == "tool"
    }
    assert tool_results["c1"]["monthly_payment"] > 0 and tool_results["c1"]["rate"] == 19.5
    assert tool_results["c1"]["debt_load_percent"] > 0 and tool_results["c1"]["current_monthly_loan_payments"] > 0
    assert tool_results["c2"]["name"] == "ООО «Пекарня Ветер»"
    later = {
        item["tool_call_id"]: json.loads(item["content"])
        for item in fake.requests[2]["messages"]
        if item["role"] == "tool"
    }
    assert later["c3"]["highlighted"] == ["risk-warning"] and later["c3"]["rejected"] == ["company-card"]

    session = api.ok(api.get(f"/assistant/sessions/{reply['session_id']}"))
    assert [item["role"] for item in session["messages"]] == ["user", "assistant"]

    fake.replies.append({"role": "assistant", "content": "Следующий ответ."})
    follow = api.ok(
        api.post(
            "/assistant/chat", json={"session_id": reply["session_id"], "message": "А если на 36?", "context": CONTEXT}
        )
    )
    assert follow["session_id"] == reply["session_id"]
    assert [item["role"] for item in fake.requests[-1]["messages"][1:]] == ["user", "assistant", "user"]


def test_agent_forces_answer_after_rounds(api: Api, llm_enabled: None) -> None:
    looping = {"role": "assistant", "content": "", "tool_calls": [tool_call("x", "list_products", {})]}
    fake = FakeLlm([looping, looping, looping, {"role": "assistant", "content": "Итог по продуктам."}])
    use_fake(api.client, fake)
    api.login("client1@demo.local")
    reply = api.ok(
        api.post("/assistant/chat", json={"message": "Какой продукт подходит?", "context": {"screen": "dashboard"}})
    )
    assert reply["message"]["content"] == "Итог по продуктам."
    assert fake.requests[-1]["tool_choice"] == "none" and len(fake.requests) == 4


def test_agent_failure_is_unavailable(api: Api, llm_enabled: None) -> None:
    fake = FakeLlm([])
    use_fake(api.client, fake)
    api.login("client1@demo.local")
    response = api.post("/assistant/chat", json={"message": "Привет", "context": CONTEXT})
    assert response.status_code == 503 and response.json()["code"] == "ASSISTANT_UNAVAILABLE"
    assert api.get("/assistant/sessions/unknown").status_code == 404


def test_agent_sees_only_own_applications(api: Api, llm_enabled: None) -> None:
    api.login("underwriter@bank.local")
    foreign = api.ok(api.get("/bank/applications", params={"status": "MANUAL_REVIEW"}))[0]["id"]
    fake = FakeLlm(
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [tool_call("a", "get_application", {"application_id": foreign})],
            },
            {"role": "assistant", "content": "Не вижу такой заявки."},
        ]
    )
    use_fake(api.client, fake)
    assert api.post("/assistant/chat", json={"message": "Статус?", "context": CONTEXT}).status_code == 403
    api.login("client1@demo.local")
    api.ok(api.post("/assistant/chat", json={"message": "Статус?", "context": CONTEXT}))
    result = next(json.loads(item["content"]) for item in fake.requests[1]["messages"] if item["role"] == "tool")
    assert result == {"error": "Заявка не найдена"}


def test_strip_echoed_suggestions() -> None:
    content = "**Платёж — 151 956 ₽.**\n\nОценка не является решением банка.\n\n*Следующие вопросы:*\n- Как снизить платёж?\n- Что будет при просрочке?"
    cleaned = strip_echo(content, ["Как снизить платёж?", "Что будет при просрочке?"])
    assert cleaned == "**Платёж — 151 956 ₽.**\n\nОценка не является решением банка."
    assert strip_echo("Только текст.", []) == "Только текст."
    inline = "Лимит — 5 350 000 ₽.\n\n*Какие сроки вам интересны?* *Хотите другие варианты?*"
    assert strip_echo(inline, ["Какой срок вам интересен?"]) == "Лимит — 5 350 000 ₽."
    assert strip_echo("Сколько ждать?", ["Что дальше?"]) == "Сколько ждать?"


def test_agent_fills_loan_form(api: Api, llm_enabled: None) -> None:
    api.login("client1@demo.local")
    draft = api.ok(
        api.post("/applications", json={"product_code": "WORKING_CAPITAL", "amount": 3_000_000, "term": 24}), 201
    )
    context = {**CONTEXT, "application_id": draft["id"]}
    fake = FakeLlm(
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [tool_call("f1", "fill_loan_form", {"amount": 99_000_000})],
            },
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [tool_call("f2", "fill_loan_form", {"amount": 2_000_000, "term": 36})],
            },
            {"role": "assistant", "content": "Подставил 2 000 000 ₽ на 36 мес., статус DRAFT, продукт EQUIPMENT."},
        ]
    )
    use_fake(api.client, fake)
    reply = api.ok(api.post("/assistant/chat", json={"message": "Поставь 2 млн на 36 месяцев", "context": context}))
    message = reply["message"]
    assert message["actions"] == [{"type": "set_loan_params", "amount": 2_000_000, "term": 36}]
    assert (
        message["content"] == "Подставил 2 000 000 ₽ на 36 мес., статус «Черновик», продукт «Кредит на оборудование»."
    )

    system = fake.requests[0]["messages"][0]["content"]
    assert '"product": "Оборотный кредит"' in system and '"product_code"' not in system
    results = {
        item["tool_call_id"]: json.loads(item["content"])
        for item in fake.requests[2]["messages"]
        if item["role"] == "tool"
    }
    assert "пределов продукта «Оборотный кредит»" in results["f1"]["error"]
    assert results["f2"]["calculation"]["term_months"] == 36 and results["f2"]["calculation"]["monthly_payment"] > 0

    session = api.ok(api.get(f"/assistant/sessions/{reply['session_id']}"))
    assert session["messages"][-1]["actions"] == message["actions"] and session["messages"][0]["actions"] == []


def test_fill_loan_form_only_on_amount_step(api: Api, llm_enabled: None) -> None:
    fake = FakeLlm(
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [tool_call("f", "fill_loan_form", {"amount": 1_000_000})],
            },
            {"role": "assistant", "content": "Откройте шаг «Сумма и срок»."},
        ]
    )
    use_fake(api.client, fake)
    api.login("client1@demo.local")
    reply = api.ok(api.post("/assistant/chat", json={"message": "Поставь 1 млн", "context": {"screen": "dashboard"}}))
    assert reply["message"]["actions"] == []
    result = next(json.loads(item["content"]) for item in fake.requests[1]["messages"] if item["role"] == "tool")
    assert "только на шаге «Сумма и срок»" in result["error"]
