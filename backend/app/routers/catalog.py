from functools import cache

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app import clock
from app.bootstrap import current_revision, head_revision
from app.config import settings
from app.deps import DatabaseDep, DbDep
from app.repo import Db
from app.schemas import AppConfig, Health, HealthReady
from app.seeds import DEMO_ACCOUNTS, DEMO_PASSWORD

router = APIRouter(tags=["config"])

QUEUE_LAG_LIMIT = 30


@cache
def migrations_head() -> str | None:
    return head_revision()


@router.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok")


@router.get("/health/live", response_model=Health)
def live() -> Health:
    return Health(status="ok")


@router.get("/health/ready", response_model=HealthReady, responses={503: {"model": HealthReady}})
def ready(database: DatabaseDep) -> HealthReady | JSONResponse:
    now = clock.now_ms()
    try:
        with database.session() as session:
            revision = current_revision(session.connection())
            due, oldest = Db(session).queue(now)
    except OperationalError:
        body = HealthReady(status="unavailable", checks={"database": "unavailable"}, queue_due=0, queue_lag_seconds=0)
        return JSONResponse(body.model_dump(), status_code=503)
    lag = round((now - oldest) / 1000, 1) if oldest is not None else 0
    checks = {
        "database": "ok",
        "migrations": "ok" if revision == migrations_head() else f"outdated: {revision}",
        "pipeline": "ok" if lag < QUEUE_LAG_LIMIT else "lagging",
        "assistant": "configured" if settings.assistant_available else "disabled",
    }
    healthy = all(checks[key] == "ok" for key in ("database", "migrations", "pipeline"))
    return HealthReady(status="ok" if healthy else "degraded", checks=checks, queue_due=due, queue_lag_seconds=lag)


@router.get("/config", response_model=AppConfig)
def config(db: DbDep) -> AppConfig:
    return AppConfig(
        assistant_enabled=settings.assistant_available,
        manual_review_amount_threshold=db.policy.manual_review_amount_threshold,
        products=db.active_products(),
        demo_password=DEMO_PASSWORD if settings.demo_accounts_on_login else None,
        demo_accounts=DEMO_ACCOUNTS if settings.demo_accounts_on_login else [],
    )
