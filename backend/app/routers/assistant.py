import asyncio
import logging

from fastapi import APIRouter, Request

from app.assistant.agent import run_agent
from app.assistant.prompt import build_system_prompt
from app.assistant.tools import Toolbox
from app.config import settings
from app.deps import ClientCtx, ClientId
from app.errors import ApiError, not_found
from app.fmt import iso
from app.models import StoredSession, uid
from app.schemas import AssistantChatRequest, AssistantChatResponse, AssistantMessage, AssistantSession
from app.store import Store

router = APIRouter(prefix="/assistant", tags=["assistant"])
logger = logging.getLogger("alpharay")

MAX_MESSAGES = 120
MAX_QUESTION = 2000


def unavailable() -> ApiError:
    return ApiError(503, "ASSISTANT_UNAVAILABLE", "Ассистент временно недоступен, все действия доступны в кабинете")


@router.post("/chat", response_model=AssistantChatResponse)
async def chat(body: AssistantChatRequest, user_id: ClientId, request: Request) -> AssistantChatResponse:
    if not settings.assistant_available:
        raise ApiError(503, "ASSISTANT_DISABLED", "Ассистент отключён")
    question = body.message.strip()[:MAX_QUESTION]
    if not question:
        raise ApiError(422, "VALIDATION", "Введите вопрос")
    store: Store = request.app.state.store

    async with store.session() as session:
        user = session.db.find_user(user_id)
        if not user:
            raise ApiError(401, "UNAUTHORIZED", "Требуется вход в систему")
        existing = next(
            (item for item in session.db.sessions if item.id == body.session_id and item.user_id == user_id),
            None,
        )
        history = [message.model_copy() for message in existing.messages] if existing else []
        system_prompt = build_system_prompt(session.db, user, body.context, session.now)
        asked_at = session.now

    toolbox = Toolbox(store, user_id, body.context)
    try:
        async with asyncio.timeout(settings.llm_total_timeout):
            reply = await run_agent(request.app.state.llm, toolbox, system_prompt, history, question)
    except Exception as error:
        logger.warning("Assistant failed: %r", error)
        raise unavailable() from error

    async with store.session() as session:
        chat_session = next(
            (item for item in session.db.sessions if item.id == body.session_id and item.user_id == user_id),
            None,
        )
        if not chat_session:
            chat_session = StoredSession(id=uid(), user_id=user_id)
            session.db.sessions.append(chat_session)
        answer = AssistantMessage(
            id=uid(),
            role="assistant",
            content=reply.content,
            hints=reply.hints,
            suggestions=reply.suggestions,
            actions=reply.actions,
            created_at=iso(session.now),
        )
        chat_session.messages.extend(
            [
                AssistantMessage(
                    id=uid(), role="user", content=question, hints=[], suggestions=[], created_at=iso(asked_at)
                ),
                answer,
            ]
        )
        chat_session.messages = chat_session.messages[-MAX_MESSAGES:]
        return AssistantChatResponse(session_id=chat_session.id, message=answer)


@router.get("/sessions/{session_id}", response_model=AssistantSession)
async def get_session(session_id: str, ctx: ClientCtx) -> AssistantSession:
    found = next((item for item in ctx.db.sessions if item.id == session_id and item.user_id == ctx.user.id), None)
    if not found:
        raise not_found("Сессия не найдена")
    return AssistantSession(session_id=found.id, messages=found.messages)
