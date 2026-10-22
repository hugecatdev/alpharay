from fastapi import APIRouter

from app.deps import AnyCtx, SessionDep
from app.errors import ApiError
from app.models import public_user
from app.schemas import LoginRequest, LoginResponse, User
from app.security import create_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, session: SessionDep) -> LoginResponse:
    email = body.email.strip().lower()
    user = next((item for item in session.db.users if item.email == email), None)
    if not user or not verify_password(body.password, user.password_hash):
        raise ApiError(401, "INVALID_CREDENTIALS", "Неверный email или пароль")
    if not user.active:
        raise ApiError(403, "ACCOUNT_DISABLED", "Учётная запись заблокирована — обратитесь к администратору банка")
    return LoginResponse(access_token=create_token(user.id), user=public_user(user))


@router.get("/me", response_model=User)
async def me(ctx: AnyCtx) -> User:
    return public_user(ctx.user)
