import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert

from app.deps import Ctx
from app.errors import ApiError
from app.models import IdempotencyRecord

HEADER = "Idempotency-Key"
REPLAYED = "Idempotent-Replayed"


@dataclass(frozen=True)
class Idempotency:
    key: str | None
    fingerprint: str
    method: str
    path: str

    def run(self, ctx: Ctx, action: Callable[[], BaseModel], status_code: int = 200) -> BaseModel | JSONResponse:
        if not self.key:
            return action()
        session = ctx.db.session
        reserved = session.execute(
            insert(IdempotencyRecord)
            .values(
                user_id=ctx.user.id,
                key=self.key,
                method=self.method,
                path=self.path,
                request_hash=self.fingerprint,
                created_at=ctx.now,
            )
            .on_conflict_do_nothing()
            .returning(IdempotencyRecord.key)
        ).scalar()
        if reserved is None:
            return self.replay(ctx)
        result = action()
        session.execute(
            update(IdempotencyRecord)
            .where(IdempotencyRecord.user_id == ctx.user.id, IdempotencyRecord.key == self.key)
            .values(status_code=status_code, response=result.model_dump(mode="json"))
        )
        return result

    def replay(self, ctx: Ctx) -> JSONResponse:
        stored = ctx.db.idempotency(ctx.user.id, self.key or "")
        if stored is None or stored.request_hash != self.fingerprint:
            raise ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Ключ Idempotency-Key уже использован для другого запроса")
        if stored.status_code is None:
            raise ApiError(409, "REQUEST_IN_PROGRESS", "Такой же запрос ещё выполняется — повторите позже")
        return JSONResponse(stored.response, status_code=stored.status_code, headers={REPLAYED: "true"})


async def idempotency(
    request: Request,
    key: Annotated[str | None, Header(alias=HEADER, max_length=128)] = None,
) -> Idempotency:
    digest = hashlib.sha256()
    digest.update(request.method.encode())
    digest.update(request.url.path.encode())
    digest.update(str(sorted(request.query_params.multi_items())).encode())
    digest.update(await request.body())
    cleaned = key.strip() if key else ""
    return Idempotency(cleaned or None, digest.hexdigest(), request.method, request.url.path)


IdempotencyDep = Annotated[Idempotency, Depends(idempotency)]
