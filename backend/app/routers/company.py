import re

from fastapi import APIRouter

from app.deps import ClientCtx
from app.errors import ApiError
from app.insights import company_insights
from app.models import CompanyRecord
from app.schemas import Company, CompanyInsights, CompanyLookup

router = APIRouter(prefix="/company", tags=["company"])

INN_PATTERN = re.compile(r"^(\d{10}|\d{12})$")


def own_company(ctx: ClientCtx) -> CompanyRecord:
    if not ctx.user.company_id:
        raise ApiError(404, "NO_COMPANY", "Компания ещё не добавлена")
    mc = ctx.db.find_company(ctx.user.company_id)
    if not mc:
        raise ApiError(404, "NOT_FOUND", "Компания не найдена")
    return mc


def registry_company(ctx: ClientCtx, raw: str) -> CompanyRecord:
    inn = re.sub(r"\s", "", raw)
    if not INN_PATTERN.match(inn):
        raise ApiError(422, "INVALID_INN", "ИНН должен содержать 10 цифр для юрлица или 12 цифр для ИП")
    mc = ctx.db.find_company_by_inn(inn)
    if not mc:
        raise ApiError(404, "NOT_FOUND", "Компания с таким ИНН не найдена в ЕГРЮЛ/ЕГРИП")
    return mc


@router.get("", response_model=Company)
def get_company(ctx: ClientCtx) -> Company:
    return own_company(ctx).company


@router.get("/lookup", response_model=CompanyLookup)
def lookup_company(ctx: ClientCtx, inn: str = "") -> CompanyLookup:
    return CompanyLookup.model_validate(registry_company(ctx, inn).company.model_dump(exclude={"id"}))


@router.get("/insights", response_model=CompanyInsights)
def get_insights(ctx: ClientCtx) -> CompanyInsights:
    return company_insights(ctx.db, own_company(ctx), ctx.now)
