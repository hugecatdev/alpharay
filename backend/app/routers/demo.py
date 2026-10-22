from fastapi import APIRouter, Response

from app.config import settings
from app.deps import StoreDep
from app.errors import ApiError

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/reset", status_code=204)
async def reset(store: StoreDep) -> Response:
    if not settings.demo_reset_enabled:
        raise ApiError(404, "NOT_FOUND", "Ресурс не найден")
    async with store.lock:
        store.reset()
    return Response(status_code=204)
