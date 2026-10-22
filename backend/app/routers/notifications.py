from fastapi import APIRouter, Response

from app.deps import AnyCtx
from app.errors import not_found
from app.schemas import AppNotification

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[AppNotification])
async def list_notifications(ctx: AnyCtx, unread: bool = False, limit: int = 0) -> list[AppNotification]:
    items = sorted(
        (item for item in ctx.db.notifications if item.user_id == ctx.user.id and (not unread or not item.is_read)),
        key=lambda item: item.created_at,
        reverse=True,
    )
    if limit > 0:
        items = items[:limit]
    return [AppNotification.model_validate(item.model_dump(exclude={"user_id"})) for item in items]


@router.post("/read-all", status_code=204)
async def read_all(ctx: AnyCtx) -> Response:
    for item in ctx.db.notifications:
        if item.user_id == ctx.user.id:
            item.is_read = True
    return Response(status_code=204)


@router.post("/{notification_id}/read", status_code=204)
async def read_one(notification_id: str, ctx: AnyCtx) -> Response:
    item = next(
        (entry for entry in ctx.db.notifications if entry.id == notification_id and entry.user_id == ctx.user.id),
        None,
    )
    if not item:
        raise not_found("Уведомление не найдено")
    item.is_read = True
    return Response(status_code=204)
