import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import APIRouter, FastAPI

from app.assistant.llm import ChatClient
from app.config import settings
from app.errors import install_error_handlers
from app.routers import admin, applications, assistant, auth, bank, catalog, company, demo, notifications
from app.schemas import ApiErrorBody
from app.store import Store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

ERROR_RESPONSES = {
    status: {"model": ApiErrorBody, "description": description}
    for status, description in {
        401: "Требуется вход",
        403: "Недостаточно прав",
        404: "Не найдено",
        409: "Конфликт состояния",
        422: "Ошибка валидации",
    }.items()
}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.store = Store(settings.data_path)
    app.state.llm = ChatClient(httpx.AsyncClient())
    try:
        yield
    finally:
        await app.state.llm.close()
        app.state.store.save()


def create_app() -> FastAPI:
    app = FastAPI(
        title="AlphaRay API",
        version="0.1.0",
        description="Бэкенд умного кредитного кабинета: конвейер заявок, кабинет андеррайтера, администрирование банка, ассистент Рэй.",
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        redoc_url=None,
    )
    install_error_handlers(app)
    api = APIRouter(prefix="/api", responses=ERROR_RESPONSES)
    for module in (catalog, auth, company, applications, notifications, assistant, bank, admin, demo):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()
