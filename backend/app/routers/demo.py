from fastapi import APIRouter, Response

from app.bootstrap import reset_demo
from app.config import settings
from app.deps import DatabaseDep
from app.errors import ApiError
from app.ratelimit import limiter

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/reset", status_code=204)
def reset(database: DatabaseDep) -> Response:
    if not settings.demo_reset_enabled:
        raise ApiError(404, "NOT_FOUND", "Ресурс не найден")
    reset_demo(database)
    limiter.reset()
    return Response(status_code=204)
