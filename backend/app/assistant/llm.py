import asyncio
import logging
from typing import Any

import httpx

from app.config import settings

JsonDict = dict[str, Any]

logger = logging.getLogger("alpharay")

RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_WAIT = 8.0
ATTEMPTS = 3


class LlmError(Exception):
    pass


def retry_after(response: httpx.Response) -> float | None:
    try:
        return float(response.headers.get("retry-after", ""))
    except ValueError:
        return None


class ChatClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        self.http = http

    async def _post(self, payload: JsonDict) -> httpx.Response:
        timeout = httpx.Timeout(settings.llm_request_timeout, connect=settings.llm_connect_timeout)
        for attempt in range(ATTEMPTS):
            last = attempt == ATTEMPTS - 1
            try:
                response = await self.http.post(
                    f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                    timeout=timeout,
                )
            except (httpx.ConnectError, httpx.ConnectTimeout) as error:
                if last:
                    raise LlmError(f"LLM недоступна: {error!r}") from error
                continue
            except httpx.HTTPError as error:
                raise LlmError(f"LLM недоступна: {error!r}") from error
            if response.status_code == 400 and "tool_use_failed" in response.text and not last:
                logger.info("LLM сформировала некорректный вызов инструмента, повтор")
                continue
            wait = retry_after(response)
            if response.status_code in RETRY_STATUSES and not last and wait is not None and wait <= MAX_RETRY_WAIT:
                logger.info("LLM ответила %s, повтор через %.1f с", response.status_code, wait)
                await asyncio.sleep(wait)
                continue
            return response
        raise LlmError("LLM недоступна")

    async def complete(self, messages: list[JsonDict], tools: list[JsonDict], tool_choice: str) -> JsonDict:
        payload: JsonDict = {
            "model": settings.llm_model,
            "messages": messages,
            "temperature": settings.llm_temperature,
            "tools": tools,
            "tool_choice": tool_choice,
        }
        if settings.llm_max_tokens > 0:
            payload["max_tokens"] = settings.llm_max_tokens
        if settings.llm_reasoning_effort:
            payload["reasoning_effort"] = settings.llm_reasoning_effort
        response = await self._post(payload)
        if response.status_code >= 400:
            raise LlmError(f"LLM ответила {response.status_code}: {response.text[:300]}")
        try:
            body = response.json()
            message = body["choices"][0]["message"]
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise LlmError("LLM вернула ответ в неожиданном формате") from error
        if not isinstance(message, dict):
            raise LlmError("LLM вернула ответ в неожиданном формате")
        usage = body.get("usage") if isinstance(body, dict) else None
        if isinstance(usage, dict):
            logger.info("LLM %s: %s токенов", settings.llm_model, usage.get("total_tokens"))
        return message

    async def close(self) -> None:
        await self.http.aclose()
