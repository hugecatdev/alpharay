import hashlib

from app.fmt import DAY, add_months, date_ru, iso, parse_ms
from app.schemas import Certificate, Company, SigningCertificate

FNS_ISSUER = "УЦ ФНС России"
CERTIFICATE_MONTHS = 15
CURRENT_ISSUED_DAYS_AGO = 97


def owner_title(company: Company) -> str:
    return "Индивидуальный предприниматель" if company.legal_form == "IP" else "Генеральный директор"


def issue(company: Company, owner: str, valid_from: int) -> Certificate:
    seed = f"{company.inn}:{owner}:{valid_from}".encode()
    return Certificate(
        id=hashlib.sha1(seed).hexdigest().upper(),
        serial=hashlib.sha256(seed).hexdigest()[:32].upper(),
        owner_name=owner,
        owner_title=owner_title(company),
        organization=company.name,
        inn=company.inn,
        ogrn=company.ogrn,
        issuer=FNS_ISSUER,
        valid_from=iso(valid_from),
        valid_to=iso(add_months(valid_from, CERTIFICATE_MONTHS)),
    )


def token_certificates(seeded_at: int, company: Company, owner: str) -> list[Certificate]:
    current = seeded_at - CURRENT_ISSUED_DAYS_AGO * DAY
    return [issue(company, owner, current), issue(company, owner, add_months(current, -CERTIFICATE_MONTHS))]


def certificate_problem(certificate: Certificate, company: Company, now: int) -> str | None:
    if parse_ms(certificate.valid_to) <= now:
        return f"Срок действия сертификата истёк {date_ru(certificate.valid_to)}"
    if certificate.owner_name != company.head_name:
        return f"Договор кредита подписывает лично {owner_title(company).lower()} — {company.head_name}"
    return None


def signing_certificates(seeded_at: int, company: Company, owner: str, now: int) -> list[SigningCertificate]:
    return [
        SigningCertificate(**item.model_dump(), problem=certificate_problem(item, company, now))
        for item in token_certificates(seeded_at, company, owner)
    ]


def certificate_at(seeded_at: int, company: Company, owner: str, at: int) -> Certificate:
    certificates = token_certificates(seeded_at, company, owner)
    return next(
        (item for item in certificates if parse_ms(item.valid_from) <= at < parse_ms(item.valid_to)), certificates[0]
    )
