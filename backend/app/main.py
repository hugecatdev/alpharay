from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.assistant.llm import ChatClient
from app.bootstrap import prepare
from app.config import settings
from app.db import Database
from app.errors import error_response, install_error_handlers
from app.labels import status_title
from app.logs import RequestContext, configure_logging
from app.pipeline import TransitionError
from app.routers import admin, applications, assistant, auth, bank, catalog, company, demo, notifications
from app.schemas import ApiErrorBody
from app.worker import PipelineWorker

ERROR_RESPONSES = {
    status: {"model": ApiErrorBody, "description": description}
    for status, description in {
        401: "Требуется вход",
        403: "Недостаточно прав",
        404: "Не найдено",
        409: "Конфликт состояния или версии",
        422: "Ошибка валидации",
        429: "Слишком много запросов",
        503: "Сервис временно недоступен",
    }.items()
}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    database = Database(settings.database_url)
    await run_in_threadpool(prepare, database)
    app.state.database = database
    app.state.llm = ChatClient(httpx.AsyncClient())
    worker = PipelineWorker(database) if settings.pipeline_worker else None
    if worker:
        worker.start()
    try:
        yield
    finally:
        if worker:
            worker.stop()
        await app.state.llm.close()
        database.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="AlphaRay API",
        version="0.2.0",
        description="Бэкенд умного кредитного кабинета: конвейер заявок на PostgreSQL, кабинет андеррайтера, "
        "администрирование банка, ассистент Рэй.",
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        redoc_url=None,
    )
    install_error_handlers(app)

    @app.exception_handler(TransitionError)
    async def handle_transition(_: Request, error: TransitionError) -> JSONResponse:
        return error_response(
            409,
            "INVALID_TRANSITION",
            f"Переход «{status_title(error.source)}» → «{status_title(error.target)}» не допускается",
        )

    app.add_middleware(RequestContext)
    api = APIRouter(prefix="/api", responses=ERROR_RESPONSES)
    for module in (catalog, auth, company, applications, notifications, assistant, bank, admin, demo):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()
