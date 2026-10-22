from fastapi import APIRouter

from app.config import settings
from app.deps import SessionDep
from app.schemas import AppConfig, Health
from app.seeds import DEMO_ACCOUNTS, DEMO_PASSWORD

router = APIRouter(tags=["config"])


@router.get("/health", response_model=Health)
async def health() -> Health:
    return Health(status="ok")


@router.get("/config", response_model=AppConfig)
async def config(session: SessionDep) -> AppConfig:
    return AppConfig(
        assistant_enabled=settings.assistant_available,
        manual_review_amount_threshold=session.db.policy.manual_review_amount_threshold,
        products=session.db.active_products(),
        demo_password=DEMO_PASSWORD if settings.demo_accounts_on_login else None,
        demo_accounts=DEMO_ACCOUNTS if settings.demo_accounts_on_login else [],
    )
