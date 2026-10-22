import re
from functools import cache

from app.labels import (
    DOCUMENT_KIND_LABELS,
    FIELD_LABELS,
    PRECHECK_LABELS,
    PURPOSE_LABELS,
    RISK_LEVEL_LABELS,
    STATUS_META,
    TAX_SYSTEM_LABELS,
)
from app.schemas import AssistantFieldValue
from app.seeds import PRODUCTS

PRODUCT_NAMES = {product.code: product.name for product in PRODUCTS}
DECISION_LABELS = {
    "APPROVED": "одобрено",
    "COUNTER_OFFER": "предложение на других условиях",
    "NEED_INFO": "нужна информация",
    "MANUAL_REVIEW": "ручное рассмотрение",
    "REJECTED": "отказ",
}
VALUE_LABELS: dict[str, dict[str, str]] = {
    "purpose_type": PURPOSE_LABELS,
    "status": {code: title for code, (title, _) in STATUS_META.items()},
    "tax_system": TAX_SYSTEM_LABELS,
    "risk_level": RISK_LEVEL_LABELS,
    "precheck_level": PRECHECK_LABELS,
    "decision_type": DECISION_LABELS,
}


def humanize_data(data: dict[str, AssistantFieldValue]) -> dict[str, AssistantFieldValue]:
    result: dict[str, AssistantFieldValue] = {}
    for key, value in data.items():
        if key.endswith("product_code"):
            if key == "product_code" and "product_name" in data:
                continue
            name = key.removesuffix("_code")
            result[name] = PRODUCT_NAMES.get(str(value), value) if value is not None else None
        elif isinstance(value, str) and key in VALUE_LABELS:
            result[key] = VALUE_LABELS[key].get(value, value)
        else:
            result[key] = value
    return result


@cache
def code_pattern() -> tuple[re.Pattern[str], dict[str, str]]:
    labels: dict[str, str] = {}
    labels.update({code: f"«{title}»" for code, (title, _) in STATUS_META.items()})
    labels.update({code: f"«{label}»" for code, label in DOCUMENT_KIND_LABELS.items()})
    labels.update({code: label for code, label in TAX_SYSTEM_LABELS.items()})
    labels.update({code: f"«{label}»" for code, label in PURPOSE_LABELS.items()})
    labels.update({code: f"«{name}»" for code, name in PRODUCT_NAMES.items()})
    labels.update(FIELD_LABELS)
    alternatives = "|".join(re.escape(code) for code in sorted(labels, key=len, reverse=True))
    return re.compile(rf"(?<![\w-])({alternatives})(?![\w-])"), labels


def scrub_codes(text: str) -> str:
    pattern, labels = code_pattern()
    return pattern.sub(lambda match: labels[match.group(1)], text)
