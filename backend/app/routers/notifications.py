from fastapi import APIRouter, Response

from app.deps import AnyCtx
from app.errors import not_found
from app.schemas import AppNotification

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[AppNotification])
def list_notifications(ctx: AnyCtx, unread: bool = False, limit: int = 0) -> list[AppNotification]:
    return [item.model() for item in ctx.db.notifications_of(ctx.user.id, unread, limit)]


@router.post("/read-all", status_code=204)
def read_all(ctx: AnyCtx) -> Response:
    ctx.db.read_all(ctx.user.id, ctx.now)
    return Response(status_code=204)


@router.post("/{notification_id}/read", status_code=204)
def read_one(notification_id: str, ctx: AnyCtx) -> Response:
    item = ctx.db.find_notification(notification_id, ctx.user.id)
    if not item:
        raise not_found("Уведомление не найдено")
    item.is_read = True
    item.read_at = ctx.now
    return Response(status_code=204)
