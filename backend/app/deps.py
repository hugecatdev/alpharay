from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.errors import ApiError
from app.models import Db, StoredApplication, StoredUser
from app.schemas import Role
from app.security import decode_token
from app.store import Session, Store

bearer = HTTPBearer(auto_error=False, description="JWT из POST /api/auth/login")


@dataclass
class Ctx:
    db: Db
    now: int
    user: StoredUser

    def own_application(self, application_id: str) -> StoredApplication | None:
        record = self.db.find_application(application_id)
        if not record or not self.user.company_id or record.company_id != self.user.company_id:
            return None
        return record


def get_store(request: Request) -> Store:
    return request.app.state.store


StoreDep = Annotated[Store, Depends(get_store)]
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


async def get_session(store: StoreDep) -> AsyncIterator[Session]:
    async with store.session() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


def unauthorized() -> ApiError:
    return ApiError(401, "UNAUTHORIZED", "Требуется вход в систему")


def forbidden() -> ApiError:
    return ApiError(403, "FORBIDDEN", "Недостаточно прав для этого действия")


def resolve_user(db: Db, credentials: HTTPAuthorizationCredentials | None) -> StoredUser:
    user_id = decode_token(credentials.credentials) if credentials else None
    user = db.find_user(user_id)
    if not user or not user.active:
        raise unauthorized()
    return user


async def get_ctx(session: SessionDep, credentials: Credentials) -> Ctx:
    return Ctx(session.db, session.now, resolve_user(session.db, credentials))


def require_role(*roles: Role):
    async def dependency(ctx: Annotated[Ctx, Depends(get_ctx)]) -> Ctx:
        if ctx.user.role not in roles:
            raise forbidden()
        return ctx

    return dependency


AnyCtx = Annotated[Ctx, Depends(get_ctx)]
ClientCtx = Annotated[Ctx, Depends(require_role("CLIENT"))]
BankCtx = Annotated[Ctx, Depends(require_role("UNDERWRITER", "ADMIN"))]
AdminCtx = Annotated[Ctx, Depends(require_role("ADMIN"))]


async def get_client_id(store: StoreDep, credentials: Credentials) -> str:
    async with store.session() as session:
        user = resolve_user(session.db, credentials)
        if user.role != "CLIENT":
            raise forbidden()
        return user.id


ClientId = Annotated[str, Depends(get_client_id)]
