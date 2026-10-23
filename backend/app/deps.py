from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import clock
from app.db import Database
from app.errors import ApiError
from app.models import ApplicationRecord, UserRecord
from app.repo import Db
from app.schemas import Role
from app.security import decode_token

bearer = HTTPBearer(auto_error=False, description="JWT из POST /api/auth/login")


@dataclass
class Ctx:
    db: Db
    now: int
    user: UserRecord

    def own_application(self, application_id: str, lock: bool = False) -> ApplicationRecord | None:
        if not self.user.company_id:
            return None
        record = self.db.find_application(application_id, lock=lock)
        if not record or record.company_id != self.user.company_id:
            return None
        return record


def get_database(request: Request) -> Database:
    return request.app.state.database


DatabaseDep = Annotated[Database, Depends(get_database)]
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


def get_db(database: DatabaseDep) -> Iterator[Db]:
    with database.session() as session:
        yield Db(session)


DbDep = Annotated[Db, Depends(get_db, scope="function")]


def unauthorized() -> ApiError:
    return ApiError(401, "UNAUTHORIZED", "Требуется вход в систему")


def forbidden() -> ApiError:
    return ApiError(403, "FORBIDDEN", "Недостаточно прав для этого действия")


def resolve_user(db: Db, credentials: HTTPAuthorizationCredentials | None) -> UserRecord:
    user_id = decode_token(credentials.credentials) if credentials else None
    user = db.find_user(user_id)
    if not user or not user.active:
        raise unauthorized()
    return user


def get_ctx(db: DbDep, credentials: Credentials) -> Ctx:
    return Ctx(db, clock.now_ms(), resolve_user(db, credentials))


def require_role(*roles: Role):
    def dependency(ctx: Annotated[Ctx, Depends(get_ctx)]) -> Ctx:
        if ctx.user.role not in roles:
            raise forbidden()
        return ctx

    return dependency


AnyCtx = Annotated[Ctx, Depends(get_ctx)]
ClientCtx = Annotated[Ctx, Depends(require_role("CLIENT"))]
BankCtx = Annotated[Ctx, Depends(require_role("UNDERWRITER", "ADMIN"))]
AdminCtx = Annotated[Ctx, Depends(require_role("ADMIN"))]


def get_client_id(database: DatabaseDep, credentials: Credentials) -> str:
    with database.session() as session:
        user = resolve_user(Db(session), credentials)
        if user.role != "CLIENT":
            raise forbidden()
        return user.id


ClientId = Annotated[str, Depends(get_client_id)]
