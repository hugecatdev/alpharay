import math
import time
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from app.config import settings

DAY = 24 * 60 * 60 * 1000
HOUR = 60 * 60 * 1000
MINUTE = 60 * 1000

TZ = ZoneInfo(settings.timezone)
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
MILLISECOND = timedelta(milliseconds=1)


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def js_round(value: float) -> int:
    return math.floor(value + 0.5)


def round_to(value: float, step: int) -> int:
    return js_round(value / step) * step


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def to_ms(moment: datetime) -> int:
    return (moment - EPOCH) // MILLISECOND


def iso(ms: int) -> str:
    moment = EPOCH + timedelta(milliseconds=ms)
    return f"{moment.strftime('%Y-%m-%dT%H:%M:%S')}.{moment.microsecond // 1000:03d}Z"


def parse_ms(value: str) -> int:
    moment = datetime.fromisoformat(value)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return to_ms(moment)


def local(ms: int) -> datetime:
    return (EPOCH + timedelta(milliseconds=ms)).astimezone(TZ)


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    total = year * 12 + month - 1 + delta
    return total // 12, total % 12 + 1


def add_months(ms: int, months: int) -> int:
    moment = local(ms)
    year, month = shift_month(moment.year, moment.month, months)
    first = moment.replace(year=year, month=month, day=1)
    return to_ms(first + timedelta(days=moment.day - 1))


def month_key(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def group(value: int) -> str:
    return f"{value:,}".replace(",", " ")


def decimal_text(value: float, digits: int) -> str:
    if not math.isfinite(value):
        return "∞" if value > 0 else "-∞"
    rounded = Decimal(repr(value)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    sign = "-" if rounded < 0 else ""
    whole, _, fraction = f"{abs(rounded):f}".partition(".")
    fraction = fraction.rstrip("0")
    text = group(int(whole))
    return f"{sign}{text},{fraction}" if fraction else f"{sign}{text}"


def money(value: float) -> str:
    return f"{group(js_round(value))} ₽"


def money_short(value: float) -> str:
    if abs(value) >= 1_000_000:
        return f"{decimal_text(value / 1_000_000, 1)} млн ₽"
    if abs(value) >= 10_000:
        return f"{js_round(value / 1000)} тыс ₽"
    return money(value)


def rate_text(value: float) -> str:
    return f"{decimal_text(value, 2)}%"


def percent(value: float, digits: int = 0) -> str:
    return f"{decimal_text(value, digits)}%"


def date_ru(value: str | int) -> str:
    moment = local(parse_ms(value) if isinstance(value, str) else value)
    return moment.strftime("%d.%m.%Y")


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def lower_first(value: str) -> str:
    return value[:1].lower() + value[1:] if value else value


def months_between(from_iso: str, to: int) -> int:
    start = local(parse_ms(from_iso))
    end = local(to)
    return max(0, (end.year - start.year) * 12 + end.month - start.month)


def plural(n: int, one: str, few: str, many: str) -> str:
    mod10 = n % 10
    mod100 = n % 100
    if mod10 == 1 and mod100 != 11:
        return one
    if 2 <= mod10 <= 4 and (mod100 < 12 or mod100 > 14):
        return few
    return many


def age_label(total_months: int) -> str:
    years = total_months // 12
    months = total_months % 12
    parts: list[str] = []
    if years:
        parts.append(f"{years} {plural(years, 'год', 'года', 'лет')}")
    if months or not years:
        parts.append(f"{months} мес.")
    return " ".join(parts)
