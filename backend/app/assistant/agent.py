import json
import logging
import re
from dataclasses import dataclass

from app.assistant.humanize import scrub_codes
from app.assistant.llm import ChatClient, JsonDict, LlmError
from app.assistant.tools import TOOL_SPECS, UI_TOOLS, Toolbox
from app.config import settings
from app.schemas import AssistantAction, AssistantHint, AssistantMessage

THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)
QUESTIONS_ONLY = re.compile(r"^(?:[^.!?]+\?\s*)+$")

logger = logging.getLogger("alpharay")


@dataclass
class AgentReply:
    content: str
    hints: list[AssistantHint]
    suggestions: list[str]
    actions: list[AssistantAction]


def clean_content(value: object) -> str:
    return THINK_BLOCK.sub("", value).strip() if isinstance(value, str) else ""


def _bare(line: str) -> str:
    return line.strip().lstrip("-•*").strip().strip("*_").strip().lower()


def _questions_only(line: str) -> bool:
    return bool(QUESTIONS_ONLY.match(re.sub(r"[*_]", "", line).strip().lstrip("-•").strip()))


def strip_echo(content: str, suggestions: list[str]) -> str:
    echoed = {_bare(item) for item in suggestions}
    lines = [line for line in content.splitlines() if not echoed or _bare(line) not in echoed]
    while lines and (
        not lines[-1].strip() or _bare(lines[-1]).endswith(":") or (echoed and _questions_only(lines[-1]))
    ):
        lines.pop()
    return "\n".join(lines).strip() or content


def finish(content: str, toolbox: Toolbox) -> AgentReply:
    return AgentReply(
        scrub_codes(strip_echo(content, toolbox.suggestions)),
        toolbox.hints,
        [scrub_codes(item) for item in toolbox.suggestions],
        toolbox.actions,
    )


def history_messages(history: list[AssistantMessage]) -> list[JsonDict]:
    recent = history[-settings.llm_history_messages :] if settings.llm_history_messages > 0 else []
    return [{"role": message.role, "content": message.content} for message in recent if message.content.strip()]


async def run_agent(
    llm: ChatClient,
    toolbox: Toolbox,
    system_prompt: str,
    history: list[AssistantMessage],
    question: str,
) -> AgentReply:
    messages: list[JsonDict] = [
        {"role": "system", "content": system_prompt},
        *history_messages(history),
        {"role": "user", "content": question},
    ]
    for round_number in range(1, max(1, settings.llm_max_rounds) + 1):
        reply = await llm.complete(messages, TOOL_SPECS, "auto")
        calls = reply.get("tool_calls") or []
        content = clean_content(reply.get("content"))
        if not calls:
            if content:
                return finish(content, toolbox)
            break
        messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": calls})
        names: list[str] = []
        for call in calls:
            function = call.get("function") or {}
            name = str(function.get("name", ""))
            names.append(name)
            result = await toolbox.run(name, function.get("arguments"))
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": str(call.get("id", "")),
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )
        logger.info("Раунд %s: %s", round_number, ", ".join(names))
        if content and all(name in UI_TOOLS for name in names):
            return finish(content, toolbox)
    reply = await llm.complete(messages, TOOL_SPECS, "none")
    content = clean_content(reply.get("content"))
    if not content:
        raise LlmError("LLM не дала текстового ответа")
    return finish(content, toolbox)
