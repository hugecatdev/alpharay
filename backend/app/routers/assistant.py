import asyncio
import logging

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app import clock
from app.assistant.agent import AgentReply, run_agent
from app.assistant.prompt import build_system_prompt
from app.assistant.tools import Toolbox
from app.config import settings
from app.db import Database
from app.deps import ClientCtx, ClientId
from app.errors import ApiError, not_found
from app.models import ChatMessageRecord, ChatSessionRecord, uid
from app.ratelimit import rate_limit
from app.repo import Db
from app.schemas import AssistantChatRequest, AssistantChatResponse, AssistantMessage, AssistantSession

router = APIRouter(prefix="/assistant", tags=["assistant"])
logger = logging.getLogger("alpharay")

MAX_MESSAGES = 120
MAX_QUESTION = 2000


def unavailable() -> ApiError:
    return ApiError(503, "ASSISTANT_UNAVAILABLE", "Ассистент временно недоступен, все действия доступны в кабинете")


def prepare_chat(
    database: Database, user_id: str, body: AssistantChatRequest
) -> tuple[list[AssistantMessage], str, int]:
    with database.session() as session:
        db = Db(session)
        user = db.find_user(user_id)
        if not user:
            raise ApiError(401, "UNAUTHORIZED", "Требуется вход в систему")
        existing = db.chat_session(body.session_id, user_id)
        history = [message.model() for message in existing.messages] if existing else []
        now = clock.now_ms()
        return history, build_system_prompt(db, user, body.context, now), now


def save_chat(
    database: Database, user_id: str, session_id: str | None, question: str, reply: AgentReply, asked_at: int
) -> AssistantChatResponse:
    with database.session() as session:
        db = Db(session)
        now = clock.now_ms()
        chat_session = db.chat_session(session_id, user_id)
        if not chat_session:
            chat_session = ChatSessionRecord(id=uid(), user_id=user_id, created_at=now, updated_at=now)
            db.add(chat_session)
        answer = ChatMessageRecord(
            id=uid(),
            role="assistant",
            content=reply.content,
            hints=reply.hints,
            suggestions=reply.suggestions,
            actions=reply.actions,
            created_at=now,
        )
        chat_session.messages.extend(
            [
                ChatMessageRecord(
                    id=uid(),
                    role="user",
                    content=question,
                    hints=[],
                    suggestions=[],
                    actions=[],
                    created_at=asked_at,
                ),
                answer,
            ]
        )
        overflow = len(chat_session.messages) - MAX_MESSAGES
        if overflow > 0:
            del chat_session.messages[:overflow]
        chat_session.updated_at = now
        return AssistantChatResponse(session_id=chat_session.id, message=answer.model())


@router.post("/chat", response_model=AssistantChatResponse, dependencies=[Depends(rate_limit("assistant", 15))])
async def chat(body: AssistantChatRequest, user_id: ClientId, request: Request) -> AssistantChatResponse:
    if not settings.assistant_available:
        raise ApiError(503, "ASSISTANT_DISABLED", "Ассистент отключён")
    question = body.message.strip()[:MAX_QUESTION]
    if not question:
        raise ApiError(422, "VALIDATION", "Введите вопрос")
    database: Database = request.app.state.database
    history, system_prompt, asked_at = await run_in_threadpool(prepare_chat, database, user_id, body)

    toolbox = Toolbox(database, user_id, body.context)
    try:
        async with asyncio.timeout(settings.llm_total_timeout):
            reply = await run_agent(request.app.state.llm, toolbox, system_prompt, history, question)
    except Exception as error:
        logger.warning("Assistant failed: %r", error)
        raise unavailable() from error

    return await run_in_threadpool(save_chat, database, user_id, body.session_id, question, reply, asked_at)


@router.get("/sessions/{session_id}", response_model=AssistantSession)
def get_session(session_id: str, ctx: ClientCtx) -> AssistantSession:
    found = ctx.db.chat_session(session_id, ctx.user.id)
    if not found:
        raise not_found("Сессия не найдена")
    return AssistantSession(session_id=found.id, messages=[message.model() for message in found.messages])
