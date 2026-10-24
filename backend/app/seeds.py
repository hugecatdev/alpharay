import math
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache

from app.audit import decision_summary, record_audit
from app.decision import Verdict
from app.fmt import DAY, HOUR, MINUTE, add_months, iso, local, month_key, parse_ms, shift_month
from app.insights import derived_financials
from app.models import (
    ApplicationRecord,
    CompanyRecord,
    DocumentRecord,
    ExternalLoanRecord,
    NotificationRecord,
    ProductRecord,
    SourceRecord,
    TurnoverRecord,
    UserRecord,
    default_policy,
    uid,
)
from app.pipeline import (
    SYSTEM,
    Actor,
    accept_offer,
    actor_of,
    advance,
    apply_verdict,
    assign,
    complete_signing,
    create_draft,
    disburse,
    start_signing,
    submit_application,
)
from app.repo import Db
from app.schemas import (
    ActiveLoan,
    BkiData,
    BkiLoan,
    Company,
    Consents,
    DemoAccount,
    DocumentKind,
    EgrulData,
    FnsData,
    InfoRequestItem,
    LegalForm,
    NotificationType,
    Product,
    PurposeType,
    TaxSystem,
    TurnoverMonth,
)
from app.security import hash_password
from app.signature import certificate_at

DEMO_PASSWORD = "demo"
UNDERWRITER_NAME = "Ковалёва Ирина Михайловна"

DEMO_ACCOUNTS = [
    DemoAccount(
        email="client1@demo.local",
        title="ООО «Пекарня Ветер»",
        description="Сильный профиль: до 5 млн — автоодобрение, больше — специалист",
    ),
    DemoAccount(
        email="client2@demo.local",
        title="ИП Смирнов А.В.",
        description="Молодой бизнес: крупная сумма не проходит по нагрузке — встречное предложение",
    ),
    DemoAccount(
        email="client3@demo.local",
        title="ООО «СтройМастер»",
        description="Просрочка 45 дней в БКИ: ручное рассмотрение",
    ),
    DemoAccount(
        email="client4@demo.local",
        title="ООО «Радуга Трейд»",
        description="Налоговый долг и просрочка: отказ по стоп-факторам",
    ),
    DemoAccount(
        email="client5@demo.local", title="ООО «ТехноСервис»", description="Выручка расходится с ФНС: запрос информации"
    ),
    DemoAccount(
        email="underwriter@bank.local", title="Андеррайтер", description="Очередь ручного рассмотрения и решения"
    ),
    DemoAccount(
        email="admin@bank.local",
        title="Руководитель кредитного управления",
        description="Очередь, статистика и API администрирования",
    ),
]

PRIORITY_OKVED = [f"{code:02d}" for code in range(10, 34)] + ["01", "02", "03", "55", "62", "63", "79"]

PRODUCTS = [
    Product(
        code="OVERDRAFT",
        name="Овердрафт для бизнеса",
        description=(
            "Лимит к расчётному счёту: платежи поставщикам, аренда и налоги проходят даже при нуле на счёте. "
            "Проценты — только за использованную сумму, долг гасится автоматически из поступлений выручки."
        ),
        min_amount=100_000,
        max_amount=5_000_000,
        min_term=1,
        max_term=12,
        base_rate=21,
        purpose_types=["CASH_GAP"],
        requires_invoice=False,
        category="WORKING",
        collateral="NONE",
        repayment="REVOLVING",
        targeted=False,
    ),
    Product(
        code="WORKING_CAPITAL",
        name="Оборотный кредит",
        description=(
            "Пополнение оборотных средств: закупка товара, сырья и материалов, подготовка к сезону, крупный заказ. "
            "Равные ежемесячные платежи."
        ),
        min_amount=300_000,
        max_amount=15_000_000,
        min_term=3,
        max_term=36,
        base_rate=19.5,
        purpose_types=["WORKING_CAPITAL", "CASH_GAP"],
        requires_invoice=False,
        category="WORKING",
        collateral="GUARANTEE",
        targeted=False,
    ),
    Product(
        code="CREDIT_LINE",
        name="Кредитная линия",
        description=(
            "Одобренный лимит, который выбираете траншами по мере необходимости. "
            "Проценты начисляются только на фактически полученные деньги."
        ),
        min_amount=1_000_000,
        max_amount=30_000_000,
        min_term=6,
        max_term=36,
        base_rate=19,
        purpose_types=["WORKING_CAPITAL", "CASH_GAP"],
        requires_invoice=False,
        category="WORKING",
        collateral="GUARANTEE",
        targeted=False,
    ),
    Product(
        code="EQUIPMENT",
        name="Кредит на оборудование",
        description=(
            "Покупка нового или б/у оборудования, техники и транспорта. Длинный срок — комфортный платёж. "
            "Собственный аванс — от 10% стоимости, оборудование остаётся в залоге у банка. "
            "Понадобится счёт или договор поставщика."
        ),
        min_amount=500_000,
        max_amount=30_000_000,
        min_term=12,
        max_term=60,
        base_rate=18,
        purpose_types=["EQUIPMENT"],
        requires_invoice=True,
        category="INVESTMENT",
        collateral="EQUIPMENT",
        down_payment_share=0.1,
        targeted=True,
    ),
    Product(
        code="LEASING",
        name="Лизинг оборудования и транспорта",
        description=(
            "Финансовая аренда техники, спецтехники и автотранспорта с выкупом в конце срока. "
            "На ОСН платежи уменьшают налог на прибыль, НДС принимается к вычету."
        ),
        min_amount=500_000,
        max_amount=50_000_000,
        min_term=12,
        max_term=60,
        base_rate=17,
        purpose_types=["EQUIPMENT"],
        requires_invoice=True,
        category="INVESTMENT",
        collateral="EQUIPMENT",
        down_payment_share=0.1,
        targeted=True,
    ),
    Product(
        code="INVESTMENT",
        name="Инвестиционный кредит",
        description=(
            "Под конкретный проект: производственная линия, модернизация, открытие новых точек. "
            "Длинный срок, целевое использование подтверждается документами."
        ),
        min_amount=3_000_000,
        max_amount=100_000_000,
        min_term=24,
        max_term=120,
        base_rate=16.5,
        purpose_types=["INVESTMENT", "EQUIPMENT"],
        requires_invoice=False,
        category="INVESTMENT",
        collateral="EQUIPMENT",
        targeted=True,
    ),
    Product(
        code="COMMERCIAL_MORTGAGE",
        name="Коммерческая ипотека",
        description=(
            "Покупка офиса, склада или торговой точки. Объект сразу становится залогом, "
            "поэтому ставка ниже, чем по беззалоговым продуктам."
        ),
        min_amount=5_000_000,
        max_amount=150_000_000,
        min_term=36,
        max_term=180,
        base_rate=15,
        purpose_types=["REAL_ESTATE"],
        requires_invoice=False,
        category="INVESTMENT",
        collateral="PROPERTY",
        targeted=True,
    ),
    Product(
        code="GOV_CONTRACT",
        name="Кредит на исполнение госконтракта",
        description=(
            "Для победителей тендеров по 44-ФЗ и 223-ФЗ: закупка материалов и старт работ "
            "до первого платежа заказчика. Обеспечение — права требования по контракту."
        ),
        min_amount=500_000,
        max_amount=50_000_000,
        min_term=3,
        max_term=24,
        base_rate=18.5,
        purpose_types=["GOV_CONTRACT"],
        requires_invoice=False,
        category="SPECIAL",
        collateral="CONTRACT",
        targeted=True,
    ),
    Product(
        code="SUBSIDIZED",
        name="Льготный кредит с господдержкой",
        description=(
            "Сниженная ставка для приоритетных отраслей: производство, IT, туризм, сельское хозяйство. "
            "Субсидируется через Минэкономразвития и Корпорацию МСП."
        ),
        min_amount=500_000,
        max_amount=50_000_000,
        min_term=6,
        max_term=120,
        base_rate=10.5,
        purpose_types=["WORKING_CAPITAL", "INVESTMENT", "EQUIPMENT"],
        requires_invoice=False,
        category="SPECIAL",
        collateral="GUARANTEE",
        targeted=True,
        okved_prefixes=PRIORITY_OKVED,
    ),
    Product(
        code="REFINANCING",
        name="Рефинансирование кредитов",
        description=(
            "Объединение действующих кредитов бизнеса в один с меньшей ставкой и одним платежом. "
            "Банк сам гасит долги в других банках."
        ),
        min_amount=500_000,
        max_amount=50_000_000,
        min_term=6,
        max_term=60,
        base_rate=17.5,
        purpose_types=["REFINANCING"],
        requires_invoice=False,
        category="SPECIAL",
        collateral="GUARANTEE",
        targeted=True,
    ),
]
BAKERY_SEASON = [0.86, 0.84, 0.9, 0.94, 0.98, 0.93, 0.9, 0.92, 1.0, 1.04, 1.1, 1.42]
VOLATILE = [1.2, 0.7, 1.35, 0.85, 1.1, 0.6, 1.4, 0.9, 0.75, 1.25, 0.95, 0.8]


@cache
def demo_password_hash() -> str:
    return hash_password(DEMO_PASSWORD)


def noise(index: int, seed: int) -> float:
    value = math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
    return value - math.floor(value) - 0.5


def thousands(value: float) -> int:
    return math.floor(value / 1000 + 0.5) * 1000


def build_turnover(now: int, months: int, fn: Callable[[int, int], tuple[float, float]]) -> list[TurnoverMonth]:
    current = local(now)
    rows: list[TurnoverMonth] = []
    for offset in range(months, 0, -1):
        year, month = shift_month(current.year, current.month, -offset)
        inflow, outflow = fn(months - offset, month - 1)
        rows.append(TurnoverMonth(month=month_key(year, month), inflow=thousands(inflow), outflow=thousands(outflow)))
    return rows


@dataclass
class FnsInput:
    tax_debt: int = 0
    account_blocks: bool = False
    mass_address: bool = False
    disqualified_head: bool = False
    revenue_factor: float = 1.0


def make_company(
    company: Company,
    fns: FnsInput,
    bki: BkiData,
    turnover: list[TurnoverMonth],
    external_loans: list[ActiveLoan] | None = None,
) -> CompanyRecord:
    revenue = sum(month.inflow for month in turnover)
    record = CompanyRecord(**company.model_dump(), created_at=0)
    record.source = SourceRecord(
        company_id=company.id,
        egrul=EgrulData(
            status="Действующее",
            ogrn=company.ogrn,
            registration_date=company.registration_date,
            okved_main=company.okved_main,
            okved_name=company.okved_name,
            head_name=company.head_name,
            address=company.address,
        ),
        fns=FnsData(
            tax_debt=fns.tax_debt,
            account_blocks=fns.account_blocks,
            mass_address=fns.mass_address,
            disqualified_head=fns.disqualified_head,
            declared_revenue_12m=thousands(revenue * fns.revenue_factor),
        ),
        bki=bki,
        updated_at=0,
    )
    record.turnover_rows = [
        TurnoverRecord(company_id=company.id, month=month.month, inflow=month.inflow, outflow=month.outflow)
        for month in turnover
    ]
    record.loan_rows = [
        ExternalLoanRecord(
            id=loan.id,
            company_id=company.id,
            contract_number=loan.contract_number,
            product_name=loan.product_name,
            amount=loan.amount,
            balance=loan.balance,
            rate=loan.rate,
            monthly_payment=loan.monthly_payment,
            next_payment_date=parse_ms(loan.next_payment_date),
            issued_at=parse_ms(loan.issued_at),
            maturity_date=parse_ms(loan.maturity_date),
        )
        for loan in external_loans or []
    ]
    return record


def bki_loan(creditor: str, amount: int, balance: int, opened_at: str, closed_at: str | None, overdue: int) -> BkiLoan:
    return BkiLoan(
        creditor=creditor,
        amount=amount,
        balance=balance,
        opened_at=opened_at,
        closed_at=closed_at,
        max_overdue_days=overdue,
    )


def demo_companies(now: int) -> list[CompanyRecord]:
    def bakery(index: int, month: int) -> tuple[float, float]:
        season = BAKERY_SEASON[month]
        inflow = 3_050_000 * (1 + 0.012 * index) * season * (1 + noise(index, 1) * 0.04)
        return inflow, inflow * (0.86 - (season - 1) * 0.15) * (1 + noise(index, 2) * 0.02)

    def young(index: int, _: int) -> tuple[float, float]:
        inflow = 260_000 * 1.18**index * (1 + noise(index, 3) * 0.06)
        return inflow, inflow * (0.74 + noise(index, 4) * 0.04)

    def construction(index: int, _: int) -> tuple[float, float]:
        trend = 1 - 0.01 * index
        return 2_600_000 * trend * VOLATILE[index], 2_600_000 * 0.93 * trend * (0.9 + 0.1 * VOLATILE[index])

    def declining(index: int, _: int) -> tuple[float, float]:
        inflow = 2_500_000 * 0.95**index * (1 + noise(index, 5) * 0.05)
        return inflow, inflow * (1.03 + noise(index, 6) * 0.02)

    def stable(index: int, _: int) -> tuple[float, float]:
        inflow = 2_000_000 * (1 + 0.005 * index) * (1 + noise(index, 7) * 0.08)
        return inflow, inflow * (0.82 + noise(index, 8) * 0.03)

    return [
        make_company(
            Company(
                id="c-client1",
                inn="7714382915",
                ogrn="1187746512340",
                name="ООО «Пекарня Ветер»",
                legal_form="OOO",
                registration_date="2018-03-14",
                okved_main="10.71",
                okved_name="Производство хлеба и мучных кондитерских изделий недлительного хранения",
                address="г. Москва, ул. Верхняя Масловка, д. 20, стр. 2",
                head_name="Ветрова Анна Сергеевна",
                tax_system="USN_15",
                employees_count=34,
            ),
            FnsInput(revenue_factor=0.97),
            BkiData(
                rating=872,
                rating_label="Высокий",
                active_loans=[],
                closed_loans=[
                    bki_loan(
                        "ООО «Лизинг-Центр»", 2_800_000, 0, "2020-02-10T00:00:00.000Z", "2023-02-10T00:00:00.000Z", 0
                    ),
                    bki_loan(
                        "Банк «Северный»", 1_000_000, 0, "2021-09-01T00:00:00.000Z", "2022-09-01T00:00:00.000Z", 0
                    ),
                ],
                max_overdue_days_24m=0,
            ),
            build_turnover(now, 12, bakery),
        ),
        make_company(
            Company(
                id="c-client2",
                inn="502913648207",
                ogrn="326502700041852",
                name="ИП Смирнов А.В.",
                legal_form="IP",
                registration_date=iso(add_months(now, -8))[:10],
                okved_main="47.91",
                okved_name="Торговля розничная по почте или по информационно-коммуникационной сети Интернет",
                address="Московская обл., г. Химки, ул. Молодёжная, д. 12, кв. 48",
                head_name="Смирнов Алексей Викторович",
                tax_system="USN_6",
                employees_count=2,
            ),
            FnsInput(revenue_factor=0.95),
            BkiData(
                rating=640,
                rating_label="Средний — короткая история",
                active_loans=[],
                closed_loans=[],
                max_overdue_days_24m=0,
            ),
            build_turnover(now, 8, young),
        ),
        make_company(
            Company(
                id="c-client3",
                inn="5260417832",
                ogrn="1155260003418",
                name="ООО «СтройМастер»",
                legal_form="OOO",
                registration_date="2015-06-02",
                okved_main="41.20",
                okved_name="Строительство жилых и нежилых зданий",
                address="г. Нижний Новгород, ул. Ларина, д. 7, офис 305",
                head_name="Кравцов Игорь Петрович",
                tax_system="OSN",
                employees_count=58,
            ),
            FnsInput(revenue_factor=1.02),
            BkiData(
                rating=520,
                rating_label="Ниже среднего",
                active_loans=[bki_loan("Банк «Волга-Кредит»", 9_000_000, 5_200_000, iso(now - 420 * DAY), None, 45)],
                closed_loans=[
                    bki_loan(
                        "ООО «Лизинг-Центр»", 4_500_000, 0, "2019-05-20T00:00:00.000Z", "2022-05-20T00:00:00.000Z", 12
                    ),
                ],
                max_overdue_days_24m=45,
            ),
            build_turnover(now, 12, construction),
            [
                ActiveLoan(
                    id="ext-c3-1",
                    contract_number="ВК-2025-01187",
                    product_name="Кредит на пополнение оборотных средств (Банк «Волга-Кредит»)",
                    amount=9_000_000,
                    balance=5_200_000,
                    rate=21.5,
                    monthly_payment=420_000,
                    next_payment_date=iso(now + 9 * DAY),
                    issued_at=iso(now - 420 * DAY),
                    maturity_date=iso(now + 400 * DAY),
                )
            ],
        ),
        make_company(
            Company(
                id="c-client4",
                inn="7728519364",
                ogrn="1167746893215",
                name="ООО «Радуга Трейд»",
                legal_form="OOO",
                registration_date="2016-09-20",
                okved_main="46.49",
                okved_name="Торговля оптовая прочими бытовыми товарами",
                address="г. Москва, Варшавское ш., д. 125, стр. 1, офис 14",
                head_name="Гусейнов Тимур Рашидович",
                tax_system="OSN",
                employees_count=12,
            ),
            FnsInput(tax_debt=312_000, account_blocks=True, revenue_factor=0.99),
            BkiData(
                rating=310,
                rating_label="Низкий",
                active_loans=[bki_loan("Банк «Столичный»", 2_500_000, 1_900_000, iso(now - 640 * DAY), None, 203)],
                closed_loans=[],
                max_overdue_days_24m=203,
            ),
            build_turnover(now, 12, declining),
            [
                ActiveLoan(
                    id="ext-c4-1",
                    contract_number="СТ-2024-55102",
                    product_name="Кредит на развитие (Банк «Столичный»)",
                    amount=2_500_000,
                    balance=1_900_000,
                    rate=23,
                    monthly_payment=98_000,
                    next_payment_date=iso(now + 4 * DAY),
                    issued_at=iso(now - 640 * DAY),
                    maturity_date=iso(now + 450 * DAY),
                )
            ],
        ),
        make_company(
            Company(
                id="c-client5",
                inn="7802615473",
                ogrn="1177847201946",
                name="ООО «ТехноСервис»",
                legal_form="OOO",
                registration_date="2017-04-11",
                okved_main="62.02",
                okved_name="Деятельность консультативная и работы в области компьютерных технологий",
                address="г. Санкт-Петербург, Лиговский пр., д. 50, корп. 13",
                head_name="Орлов Денис Андреевич",
                tax_system="USN_15",
                employees_count=21,
            ),
            FnsInput(revenue_factor=0.74),
            BkiData(
                rating=760,
                rating_label="Хороший",
                active_loans=[],
                closed_loans=[
                    bki_loan("Банк «Невский»", 1_200_000, 0, "2021-03-01T00:00:00.000Z", "2023-03-01T00:00:00.000Z", 0),
                ],
                max_overdue_days_24m=0,
            ),
            build_turnover(now, 12, stable),
        ),
    ]


@dataclass
class Background:
    id: str
    name: str
    legal_form: LegalForm
    inn: str
    ogrn: str
    registration_date: str
    okved_main: str
    okved_name: str
    address: str
    head_name: str
    base: int
    margin: float
    employees: int
    rating: int
    rating_label: str
    overdue: int
    tax_debt: int
    seed: int


BACKGROUND = [
    Background(
        "c-bg-honey",
        "ООО «Северный Мёд»",
        "OOO",
        "2901284573",
        "1162901004127",
        "2016-05-17",
        "10.89",
        "Производство прочих пищевых продуктов",
        "г. Архангельск, пр. Ломоносова, д. 81",
        "Ершов Павел Константинович",
        5_200_000,
        0.12,
        41,
        705,
        "Хороший",
        8,
        0,
        11,
    ),
    Background(
        "c-bg-salon",
        "ИП Гарипова Л.Р.",
        "IP",
        "165904381276",
        "319169000127834",
        "2019-11-05",
        "96.02",
        "Предоставление услуг парикмахерскими и салонами красоты",
        "г. Казань, ул. Баумана, д. 44",
        "Гарипова Лилия Рустамовна",
        780_000,
        0.07,
        6,
        610,
        "Средний",
        35,
        0,
        13,
    ),
    Background(
        "c-bg-logistic",
        "ООО «Логистик-Юг»",
        "OOO",
        "2311298460",
        "1192375036514",
        "2019-04-22",
        "49.41",
        "Деятельность автомобильного грузового транспорта",
        "г. Краснодар, ул. Уральская, д. 126",
        "Зайцев Роман Олегович",
        9_400_000,
        0.11,
        63,
        812,
        "Высокий",
        0,
        0,
        17,
    ),
    Background(
        "c-bg-green",
        "ООО «Зелёный Квартал»",
        "OOO",
        "6671093825",
        "1186658041932",
        "2018-08-30",
        "68.20",
        "Аренда и управление собственным или арендованным недвижимым имуществом",
        "г. Екатеринбург, ул. Малышева, д. 51, офис 1102",
        "Полякова Марина Игоревна",
        1_300_000,
        -0.02,
        5,
        390,
        "Низкий",
        124,
        87_400,
        19,
    ),
    Background(
        "c-bg-media",
        "ООО «Апельсин Медиа»",
        "OOO",
        "7705982316",
        "1207700318245",
        "2020-07-14",
        "73.11",
        "Деятельность рекламных агентств",
        "г. Москва, ул. Большая Ордынка, д. 40, стр. 4",
        "Тихонов Артём Сергеевич",
        3_100_000,
        0.09,
        17,
        668,
        "Средний",
        0,
        0,
        23,
    ),
    Background(
        "c-bg-coffee",
        "ООО «Кофейня Зерно»",
        "OOO",
        "7106539184",
        "1177154012683",
        "2017-10-02",
        "56.10",
        "Деятельность ресторанов и услуги по доставке продуктов питания",
        "г. Тула, пр. Ленина, д. 33",
        "Соколова Евгения Андреевна",
        1_900_000,
        0.14,
        14,
        798,
        "Хороший",
        0,
        0,
        29,
    ),
]


def background_company(now: int, item: Background) -> CompanyRecord:
    def flow(index: int, _: int) -> tuple[float, float]:
        inflow = item.base * (1 + 0.006 * index) * (1 + noise(index, item.seed) * 0.12)
        return inflow, inflow * (1 - item.margin) * (1 + noise(index, item.seed + 1) * 0.03)

    tax_system: TaxSystem = "PATENT" if item.legal_form == "IP" else "USN_15"
    return make_company(
        Company(
            id=item.id,
            inn=item.inn,
            ogrn=item.ogrn,
            name=item.name,
            legal_form=item.legal_form,
            registration_date=item.registration_date,
            okved_main=item.okved_main,
            okved_name=item.okved_name,
            address=item.address,
            head_name=item.head_name,
            tax_system=tax_system,
            employees_count=item.employees,
        ),
        FnsInput(tax_debt=item.tax_debt, revenue_factor=0.98),
        BkiData(
            rating=item.rating,
            rating_label=item.rating_label,
            active_loans=[],
            closed_loans=[],
            max_overdue_days_24m=item.overdue,
        ),
        build_turnover(now, 12, flow),
    )


def demo_users(now: int) -> list[UserRecord]:
    rows = [
        (
            "u-client1",
            "client1@demo.local",
            "Ветрова Анна Сергеевна",
            "CLIENT",
            "Генеральный директор, собственник",
            "c-client1",
        ),
        (
            "u-client2",
            "client2@demo.local",
            "Смирнов Алексей Викторович",
            "CLIENT",
            "Индивидуальный предприниматель",
            "c-client2",
        ),
        ("u-client3", "client3@demo.local", "Лебедева Ольга Николаевна", "CLIENT", "Главный бухгалтер", "c-client3"),
        ("u-client4", "client4@demo.local", "Гусейнов Тимур Рашидович", "CLIENT", "Генеральный директор", "c-client4"),
        ("u-client5", "client5@demo.local", "Орлов Денис Андреевич", "CLIENT", "Генеральный директор", "c-client5"),
        ("u-underwriter", "underwriter@bank.local", UNDERWRITER_NAME, "UNDERWRITER", "Кредитный аналитик", None),
        (
            "u-underwriter2",
            "underwriter2@bank.local",
            "Белов Максим Олегович",
            "UNDERWRITER",
            "Кредитный аналитик",
            None,
        ),
        (
            "u-admin",
            "admin@bank.local",
            "Захарова Елена Викторовна",
            "ADMIN",
            "Руководитель кредитного управления МСБ",
            None,
        ),
    ]
    password_hash = demo_password_hash()
    return [
        UserRecord(
            id=user_id,
            email=email,
            full_name=full_name,
            role=role,
            position=position,
            company_id=company_id,
            password_hash=password_hash,
            active=True,
            created_at=now - (len(rows) - index),
        )
        for index, (user_id, email, full_name, role, position, company_id) in enumerate(rows)
    ]


def document(kind: DocumentKind, filename: str, size: int, at: int) -> DocumentRecord:
    return DocumentRecord(
        id=uid(), kind=kind, filename=filename, size=size, media_type="application/pdf", created_at=at
    )


def draft_record(
    db: Db,
    mc: CompanyRecord,
    user_id: str | None,
    product_code: str,
    amount: int,
    term: int,
    purpose: str,
    purpose_type: PurposeType,
    created_at: int,
) -> ApplicationRecord:
    product = db.find_product(product_code)
    if product is None:
        raise LookupError(product_code)
    return create_draft(db, mc, product, amount, term, purpose, purpose_type, db.find_user(user_id), created_at)


def prepare_for_submit(db: Db, record: ApplicationRecord, at: int, documents: list[DocumentRecord]) -> None:
    mc = db.find_company(record.company_id)
    if mc is None:
        raise LookupError(record.company_id)
    record.company_confirmed = True
    record.financials = derived_financials(db, mc, at)
    record.documents.extend(documents)
    record.consents = Consents(bki=True, personal_data=True, risks=True)


def applicant(db: Db, record: ApplicationRecord) -> Actor:
    user = db.find_user(record.user_id)
    return actor_of(user) if user else Actor("CLIENT", record.company.head_name)


def run_pipeline(db: Db, record: ApplicationRecord, start: int) -> int:
    submit_application(db, record, applicant(db, record), start, 0)
    advance(db, record, start + 10 * MINUTE)
    decision = record.decision
    if decision is None:
        raise LookupError(record.number)
    return decision.created_at


def sign_and_disburse(db: Db, record: ApplicationRecord, sign_at: int) -> None:
    offer = record.offer
    if offer is None:
        raise LookupError(record.number)
    actor = applicant(db, record)
    accept_offer(db, record, offer, actor, sign_at - 10 * MINUTE)
    start_signing(db, record, actor, sign_at)
    signed_at = sign_at + 3 * MINUTE
    certificate = certificate_at(db.seeded_at, record.company, record.company.head_name, signed_at)
    complete_signing(
        db, record, actor, signed_at, "KEP", certificate, "Договор подписан квалифицированной электронной подписью"
    )
    disburse(db, record, sign_at + 2 * HOUR, SYSTEM)


def seed_notification(
    db: Db,
    user_id: str,
    kind: NotificationType,
    title: str,
    body: str,
    at: int,
    is_read: bool,
    application_id: str | None,
) -> None:
    db.add(
        NotificationRecord(
            id=uid(),
            user_id=user_id,
            application_id=application_id,
            type=kind,
            title=title,
            body=body,
            is_read=is_read,
            created_at=at,
            read_at=at if is_read else None,
        )
    )


def underwriter(db: Db, user_id: str) -> UserRecord:
    user = db.find_user(user_id)
    if user is None:
        raise LookupError(user_id)
    return user


def seed_assign(db: Db, record: ApplicationRecord, user_id: str, at: int) -> None:
    user = underwriter(db, user_id)
    assign(record, user)
    record_audit(db, user, "application.assign", "application", record.id, f"Заявка {record.number} взята в работу", at)


def seed_decision(db: Db, record: ApplicationRecord, user_id: str, verdict: Verdict, at: int) -> None:
    user = underwriter(db, user_id)
    apply_verdict(db, record, verdict, actor_of(user), at)
    record_audit(db, user, "application.decision", "application", record.id, decision_summary(record), at)


def seed_catalog(db: Db, now: int) -> None:
    for position, product in enumerate(PRODUCTS):
        record = ProductRecord(code=product.code, position=position, version=1, updated_at=now)
        record.assign(product.model_copy(deep=True))
        db.add(record)
    db.save_policy(default_policy(), None, now)


def seed_companies(db: Db, now: int) -> None:
    for record in [
        *demo_companies(now),
        *(background_company(now, item) for item in BACKGROUND),
    ]:
        record.created_at = now
        record.source.updated_at = now
        db.add(record)
    db.flush()
    for user in demo_users(now):
        db.add(user)
    db.flush()


def company(db: Db, company_id: str) -> CompanyRecord:
    found = db.find_company(company_id)
    if found is None:
        raise LookupError(company_id)
    return found


def seed_demo(db: Db, now: int) -> None:
    db.set_seeded_at(now)
    seed_catalog(db, now)
    seed_companies(db, now)

    c1 = company(db, "c-client1")
    history = draft_record(
        db,
        c1,
        "u-client1",
        "WORKING_CAPITAL",
        1_500_000,
        18,
        "Закупка муки и упаковки к новогоднему сезону",
        "WORKING_CAPITAL",
        now - 152 * DAY - 40 * MINUTE,
    )
    history_start = now - 152 * DAY
    prepare_for_submit(
        db,
        history,
        history_start,
        [document("BANK_STATEMENT", "Выписка_по_счёту_12_мес.pdf", 482_133, history_start - 10 * MINUTE)],
    )
    history_decision = run_pipeline(db, history, history_start)
    sign_and_disburse(db, history, history_decision + 20 * HOUR)

    draft = draft_record(
        db,
        c1,
        "u-client1",
        "EQUIPMENT",
        2_400_000,
        36,
        "Покупка печи и тестомеса",
        "EQUIPMENT",
        now - 2 * DAY,
    )
    draft.company_confirmed = True

    review = draft_record(
        db,
        company(db, "c-client3"),
        "u-client3",
        "WORKING_CAPITAL",
        4_000_000,
        24,
        "Закупка стройматериалов для второй очереди жилого комплекса",
        "WORKING_CAPITAL",
        now - 4 * HOUR,
    )
    review_start = now - 3 * HOUR - 5 * MINUTE
    prepare_for_submit(
        db,
        review,
        review_start,
        [
            document("BANK_STATEMENT", "Выписка_СтройМастер_2026.pdf", 731_520, review_start - 5 * MINUTE),
            document("TAX_RETURN", "Декларация_НДС_2кв.pdf", 214_908, review_start - 4 * MINUTE),
        ],
    )
    review_decision = run_pipeline(db, review, review_start)

    honey = draft_record(
        db,
        company(db, "c-bg-honey"),
        None,
        "EQUIPMENT",
        7_500_000,
        48,
        "Линия фасовки мёда и холодильная камера",
        "EQUIPMENT",
        now - 27 * HOUR,
    )
    honey_start = now - 26 * HOUR
    prepare_for_submit(
        db,
        honey,
        honey_start,
        [
            document("EQUIPMENT_INVOICE", "Счёт_линия_фасовки.pdf", 318_400, honey_start - 20 * MINUTE),
            document("BANK_STATEMENT", "Выписка_12_мес.pdf", 528_771, honey_start - 19 * MINUTE),
        ],
    )
    run_pipeline(db, honey, honey_start)
    seed_assign(db, honey, "u-underwriter", honey_start + 3 * HOUR)

    salon = draft_record(
        db,
        company(db, "c-bg-salon"),
        None,
        "OVERDRAFT",
        900_000,
        9,
        "Оплата аренды и закупка расходных материалов до поступления выручки",
        "CASH_GAP",
        now - 70 * MINUTE,
    )
    salon_start = now - 55 * MINUTE
    prepare_for_submit(
        db, salon, salon_start, [document("BANK_STATEMENT", "Выписка_ИП.pdf", 190_442, salon_start - 3 * MINUTE)]
    )
    run_pipeline(db, salon, salon_start)
    seed_assign(db, salon, "u-underwriter2", salon_start + 20 * MINUTE)

    logistic = draft_record(
        db,
        company(db, "c-bg-logistic"),
        None,
        "EQUIPMENT",
        12_000_000,
        48,
        "Покупка двух седельных тягачей",
        "EQUIPMENT",
        now - 15 * DAY,
    )
    logistic_start = now - 14 * DAY
    prepare_for_submit(
        db,
        logistic,
        logistic_start,
        [
            document("EQUIPMENT_INVOICE", "Счёт_тягачи.pdf", 402_115, logistic_start - HOUR),
            document("BANK_STATEMENT", "Выписка_Логистик.pdf", 912_004, logistic_start - HOUR),
        ],
    )
    logistic_review = run_pipeline(db, logistic, logistic_start)
    seed_assign(db, logistic, "u-underwriter", logistic_review + HOUR)
    seed_decision(
        db,
        logistic,
        "u-underwriter",
        Verdict(
            "APPROVED",
            ["Сильные финансовые показатели", "Залог — приобретаемая техника"],
            ["UNDERWRITER_DECISION"],
            rate=17.5,
            comment="Одобрено, ставка снижена с учётом залога",
        ),
        logistic_review + 7 * HOUR,
    )
    sign_and_disburse(db, logistic, logistic_review + 30 * HOUR)

    green = draft_record(
        db,
        company(db, "c-bg-green"),
        None,
        "WORKING_CAPITAL",
        3_000_000,
        24,
        "Ремонт арендуемых помещений",
        "WORKING_CAPITAL",
        now - 5 * DAY - HOUR,
    )
    green_start = now - 5 * DAY
    prepare_for_submit(db, green, green_start, [])
    run_pipeline(db, green, green_start)

    media = draft_record(
        db,
        company(db, "c-bg-media"),
        None,
        "WORKING_CAPITAL",
        5_800_000,
        18,
        "Предоплата подрядчикам по крупному контракту",
        "WORKING_CAPITAL",
        now - 2 * DAY - 2 * HOUR,
    )
    media_start = now - 2 * DAY
    prepare_for_submit(
        db,
        media,
        media_start,
        [document("BANK_STATEMENT", "Выписка_Апельсин.pdf", 377_210, media_start - 10 * MINUTE)],
    )
    media_review = run_pipeline(db, media, media_start)
    seed_assign(db, media, "u-underwriter", media_review + HOUR)
    seed_decision(
        db,
        media,
        "u-underwriter",
        Verdict(
            "NEED_INFO",
            ["Нужны подтверждающие документы по контракту"],
            ["UNDERWRITER_DECISION"],
            items=[
                InfoRequestItem(code="statement_6m", label="Выписка по счёту за 6 месяцев", type="document"),
                InfoRequestItem(code="tax_return", label="Налоговая декларация за последний период", type="document"),
            ],
            comment="Приложите выписку и декларацию — по контракту крупные авансы.",
        ),
        media_review + 5 * HOUR,
    )

    coffee = draft_record(
        db,
        company(db, "c-bg-coffee"),
        None,
        "EQUIPMENT",
        1_800_000,
        36,
        "Кофемашина и оборудование для второй точки",
        "EQUIPMENT",
        now - DAY - 2 * HOUR,
    )
    coffee_start = now - DAY
    prepare_for_submit(
        db,
        coffee,
        coffee_start,
        [document("EQUIPMENT_INVOICE", "Счёт_кофемашина.pdf", 156_880, coffee_start - 5 * MINUTE)],
    )
    run_pipeline(db, coffee, coffee_start)

    db.flush()
    db.clear_notifications()
    contract_number = history.contract.number if history.contract else ""
    disbursed_ms = history.disbursed_at or now - 150 * DAY
    seed_notification(
        db,
        "u-client1",
        "DISBURSED",
        "Средства зачислены на расчётный счёт",
        f"1 500 000 ₽ по договору {contract_number}. График платежей — в карточке заявки.",
        disbursed_ms,
        True,
        history.id,
    )
    seed_notification(
        db,
        "u-client1",
        "CONTRACT_READY",
        "Договор готов к подписанию",
        "Проверьте условия и подпишите договор квалифицированной электронной подписью.",
        disbursed_ms - 2 * HOUR,
        True,
        history.id,
    )
    seed_notification(
        db,
        "u-client3",
        "APPLICATION_SUBMITTED",
        "Заявка отправлена",
        f"Заявка {review.number} принята банком.",
        review_start,
        True,
        review.id,
    )
    seed_notification(
        db,
        "u-client3",
        "DECISION_MADE",
        "Заявка передана специалисту",
        "Кредитный специалист изучит заявку. Обычно это занимает до 1 рабочего дня.",
        review_decision,
        False,
        review.id,
    )
