import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas import ApiErrorBody

logger = logging.getLogger("alpharay")


class ApiError(Exception):
    def __init__(self, status: int, code: str, detail: str, missing: list[str] | None = None) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail
        self.missing = missing


def error_response(status: int, code: str, detail: str, missing: list[str] | None = None) -> JSONResponse:
    body = ApiErrorBody(detail=detail, code=code, missing=missing)
    return JSONResponse(status_code=status, content=body.model_dump(mode="json"))


def not_found(detail: str = "Заявка не найдена") -> ApiError:
    return ApiError(404, "NOT_FOUND", detail)


def _field_name(location: tuple[object, ...]) -> str:
    parts = [str(part) for part in location if part not in ("body", "query", "path")]
    return ".".join(parts)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(_: Request, error: ApiError) -> JSONResponse:
        return error_response(error.status, error.code, error.detail, error.missing)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(_: Request, error: RequestValidationError) -> JSONResponse:
        fields = [name for name in (_field_name(tuple(item.get("loc", ()))) for item in error.errors()) if name]
        detail = f"Некорректные данные: {', '.join(dict.fromkeys(fields))}" if fields else "Некорректные данные запроса"
        return error_response(422, "VALIDATION", detail)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http(_: Request, error: StarletteHTTPException) -> JSONResponse:
        code = "NOT_FOUND" if error.status_code == 404 else "HTTP_ERROR"
        detail = "Ресурс не найден" if error.status_code == 404 else str(error.detail)
        return error_response(error.status_code, code, detail)

    @app.exception_handler(Exception)
    async def handle_unexpected(_: Request, error: Exception) -> JSONResponse:
        logger.exception("Unhandled error", exc_info=error)
        return error_response(500, "INTERNAL", "Внутренняя ошибка сервера")
