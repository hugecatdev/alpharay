from fastapi import APIRouter, Depends

from app.deps import AnyCtx, DbDep
from app.errors import ApiError
from app.ratelimit import rate_limit
from app.schemas import LoginRequest, LoginResponse, User
from app.security import create_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(rate_limit("login", 10))])
def login(body: LoginRequest, db: DbDep) -> LoginResponse:
    email = body.email.strip().lower()
    user = db.find_user_by_email(email)
    if not user or not verify_password(body.password, user.password_hash):
        raise ApiError(401, "INVALID_CREDENTIALS", "Неверный email или пароль")
    if not user.active:
        raise ApiError(403, "ACCOUNT_DISABLED", "Учётная запись заблокирована — обратитесь к администратору банка")
    return LoginResponse(access_token=create_token(user.id), user=user.model())


@router.get("/me", response_model=User)
def me(ctx: AnyCtx) -> User:
    return ctx.user.model()
