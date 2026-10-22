import math
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache

from app.audit import decision_summary, record_audit
from app.fmt import DAY, HOUR, MINUTE, add_months, iso, local, month_key, parse_ms, shift_month
from app.insights import derived_financials
from app.models import ClientKey, Db, StoredApplication, StoredCompany, StoredEvent, StoredNotification, StoredUser, uid
from app.pipeline import (
    SYSTEM_ACTOR,
    DecisionInput,
    apply_decision,
    assign,
    compute_assessment,
    set_status,
    submit_application,
)
from app.schemas import (
    ActiveLoan,
    AppDocument,
    Application,
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

DB_VERSION = 8
DEMO_PASSWORD = "demo"
UNDERWRITER_NAME = "Ковалёва Ирина Михайловна"

DEMO_ACCOUNTS = [
    DemoAccount(email="client1@demo.local", title="ООО «Пекарня Ветер»", description="Сильный профиль: до 5 млн — одобрение"),
    DemoAccount(email="client2@demo.local", title="ИП Смирнов А.В.", description="Молодой бизнес: больше 1 млн — встречное предложение"),
    DemoAccount(email="client3@demo.local", title="ООО «СтройМастер»", description="Просрочка в истории: ручное рассмотрение"),
    DemoAccount(email="client4@demo.local", title="ООО «Радуга Трейд»", description="Стоп-факторы: отказ с причинами"),
    DemoAccount(email="client5@demo.local", title="ООО «ТехноСервис»", description="Расхождение с ФНС: запрос информации"),
    DemoAccount(email="client6@demo.local", title="Петров П.С.", description="Компания не добавлена: онбординг по ИНН"),
    DemoAccount(email="underwriter@bank.local", title="Андеррайтер", description="Очередь ручного рассмотрения и решения"),
    DemoAccount(email="admin@bank.local", title="Руководитель кредитного управления", description="Очередь, статистика и API администрирования"),
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
    key: ClientKey,
    company: Company,
    fns: FnsInput,
    bki: BkiData,
    turnover: list[TurnoverMonth],
    external_loans: list[ActiveLoan] | None = None,
) -> StoredCompany:
    revenue = sum(month.inflow for month in turnover)
    return StoredCompany(
        key=key,
        company=company,
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
        turnover=turnover,
        external_loans=external_loans or [],
    )


def bki_loan(creditor: str, amount: int, balance: int, opened_at: str, closed_at: str | None, overdue: int) -> BkiLoan:
    return BkiLoan(
        creditor=creditor,
        amount=amount,
        balance=balance,
        opened_at=opened_at,
        closed_at=closed_at,
        max_overdue_days=overdue,
    )


def demo_companies(now: int) -> list[StoredCompany]:
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
            "client1",
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
            "client2",
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
            "client3",
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
            "client4",
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
            "client5",
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


def registry_companies(now: int) -> list[StoredCompany]:
    company = Company(
        id="c-registry-petrov",
        inn="771405283916",
        ogrn="324774600218734",
        name="ИП Петров П.С.",
        legal_form="IP",
        registration_date=iso(add_months(now, -27))[:10],
        okved_main="56.10",
        okved_name="Деятельность ресторанов и услуги по доставке продуктов питания",
        address="г. Москва, ул. Бутырская, д. 46, пом. 2",
        head_name="Петров Павел Сергеевич",
        tax_system="USN_6",
        employees_count=4,
    )
    stored = make_company(
        "newcomer",
        company,
        FnsInput(),
        BkiData(rating=690, rating_label="Средний", active_loans=[], closed_loans=[], max_overdue_days_24m=0),
        [],
    )
    stored.fns.declared_revenue_12m = 9_600_000
    return [stored]


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
        18,
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


def background_company(now: int, item: Background) -> StoredCompany:
    def flow(index: int, _: int) -> tuple[float, float]:
        inflow = item.base * (1 + 0.006 * index) * (1 + noise(index, item.seed) * 0.12)
        return inflow, inflow * (1 - item.margin) * (1 + noise(index, item.seed + 1) * 0.03)

    tax_system: TaxSystem = "PATENT" if item.legal_form == "IP" else "USN_15"
    return make_company(
        "background",
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


def demo_users() -> list[StoredUser]:
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
        ("u-client6", "client6@demo.local", "Петров Павел Сергеевич", "CLIENT", "Предприниматель", None),
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
        StoredUser(
            id=user_id,
            email=email,
            full_name=full_name,
            role=role,
            position=position,
            company_id=company_id,
            password_hash=password_hash,
        )
        for user_id, email, full_name, role, position, company_id in rows
    ]


def document(kind: DocumentKind, filename: str, size: int, at: int) -> AppDocument:
    return AppDocument(id=uid(), kind=kind, filename=filename, size=size, created_at=iso(at))


def draft_record(
    db: Db,
    mc: StoredCompany,
    user_id: str | None,
    product_code: str,
    amount: int,
    term: int,
    purpose: str,
    purpose_type: PurposeType,
    created_at: int,
) -> StoredApplication:
    product = next((item for item in db.products if item.code == product_code), db.products[1])
    record = StoredApplication(
        app=Application(
            id=uid(),
            number=db.next_number(),
            status="DRAFT",
            product=product.model_copy(deep=True),
            amount=amount,
            term=term,
            purpose=purpose,
            purpose_type=purpose_type,
            company=mc.company.model_copy(deep=True),
            company_confirmed=False,
            financials=None,
            documents=[],
            consents=Consents(),
            offer=None,
            info_request=None,
            decision=None,
            contract=None,
            created_at=iso(created_at),
            submitted_at=None,
            updated_at=iso(created_at),
        ),
        company_id=mc.company.id,
        user_id=user_id,
        stage_entered_at=created_at,
    )
    db.applications.append(record)
    user = db.find_user(user_id)
    db.events.append(
        StoredEvent(
            id=uid(),
            application_id=record.app.id,
            from_status=None,
            to_status="DRAFT",
            actor_type="CLIENT",
            actor_name=user.full_name if user else mc.company.head_name,
            reason="Создан черновик заявки",
            created_at=iso(created_at),
        )
    )
    return record


def prepare_for_submit(db: Db, record: StoredApplication, at: int, documents: list[AppDocument]) -> None:
    mc = db.find_company(record.company_id)
    if not mc:
        return
    record.app.company_confirmed = True
    record.app.financials = derived_financials(db, mc, at)
    record.app.documents = documents
    record.app.consents = Consents(bki=True, personal_data=True, risks=True)


def run_pipeline(db: Db, record: StoredApplication, start: int, step: int, actor_name: str) -> int:
    submit_application(db, record, actor_name, start, False)
    set_status(db, record, "VALIDATING", start + step, "SYSTEM", SYSTEM_ACTOR, "Заявка принята в обработку")
    set_status(
        db, record, "ENRICHING", start + step * 2, "SYSTEM", SYSTEM_ACTOR, "Проверка полноты и корректности пройдена"
    )
    compute_assessment(db, record, start + step * 3)
    set_status(db, record, "SCORING", start + step * 3, "SYSTEM", SYSTEM_ACTOR, "Получены данные ЕГРЮЛ, ФНС и БКИ")
    set_status(db, record, "DECIDING", start + step * 4, "SYSTEM", SYSTEM_ACTOR, "Скоринговая оценка рассчитана")
    return start + step * 5


def sign_and_disburse(db: Db, record: StoredApplication, sign_at: int, actor_name: str) -> None:
    set_status(db, record, "SIGNING", sign_at, "CLIENT", actor_name, "Запрошен код подтверждения")
    signed_at = sign_at + 3 * MINUTE
    set_status(db, record, "SIGNED", signed_at, "CLIENT", actor_name, "Договор подписан простой электронной подписью")
    if record.app.contract:
        record.app.contract.signed_at = iso(signed_at)
    if record.app.offer:
        record.app.offer.status = "ACCEPTED"
    disbursed_at = sign_at + 2 * HOUR
    set_status(db, record, "DISBURSED", disbursed_at, "SYSTEM", SYSTEM_ACTOR, "Средства перечислены на расчётный счёт")
    record.disbursed_at = iso(disbursed_at)


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
    db.notifications.append(
        StoredNotification(
            id=uid(),
            user_id=user_id,
            application_id=application_id,
            type=kind,
            title=title,
            body=body,
            is_read=is_read,
            created_at=iso(at),
        )
    )


def seed_assign(db: Db, record: StoredApplication, user_id: str, at: int) -> None:
    user = db.find_user(user_id)
    assign(record, user)
    record_audit(
        db, user, "application.assign", "application", record.app.id, f"Заявка {record.app.number} взята в работу", at
    )


def seed_decision(db: Db, record: StoredApplication, user_id: str, at: int) -> None:
    record_audit(
        db, db.find_user(user_id), "application.decision", "application", record.app.id, decision_summary(record), at
    )


def review_threshold_reason() -> list[str]:
    return ["Сумма выше порога автоматического решения 5 000 000 ₽"]


def create_seed(now: int) -> Db:
    db = Db(
        version=DB_VERSION,
        seeded_at=now,
        counter=1200,
        users=demo_users(),
        companies=[
            *demo_companies(now),
            *registry_companies(now),
            *(background_company(now, item) for item in BACKGROUND),
        ],
        products=[product.model_copy(deep=True) for product in PRODUCTS],
    )

    def company(company_id: str) -> StoredCompany:
        found = db.find_company(company_id)
        if not found:
            raise LookupError(company_id)
        return found

    c1 = company("c-client1")
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
    history_decision = run_pipeline(db, history, history_start, 40_000, "Ветрова Анна Сергеевна")
    apply_decision(
        db,
        history,
        DecisionInput("APPROVED", ["Обороты по счёту растут или стабильны", "Кредитная история без просрочек"], rate=19.5),
        "SYSTEM",
        SYSTEM_ACTOR,
        history_decision,
    )
    sign_and_disburse(db, history, history_decision + 20 * HOUR, "Ветрова Анна Сергеевна")

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
    draft.app.company_confirmed = True

    c3 = company("c-client3")
    review = draft_record(
        db,
        c3,
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
    review_decision = run_pipeline(db, review, review_start, 30_000, "Лебедева Ольга Николаевна")
    apply_decision(
        db,
        review,
        DecisionInput(
            "MANUAL_REVIEW",
            ["В кредитной истории есть просрочка 45 дней", "Нужна экспертная оценка специалиста"],
        ),
        "SYSTEM",
        SYSTEM_ACTOR,
        review_decision,
    )

    honey = draft_record(
        db,
        company("c-bg-honey"),
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
    apply_decision(
        db,
        honey,
        DecisionInput("MANUAL_REVIEW", review_threshold_reason()),
        "SYSTEM",
        SYSTEM_ACTOR,
        run_pipeline(db, honey, honey_start, 35_000, "Ершов Павел Константинович"),
    )
    seed_assign(db, honey, "u-underwriter", honey_start + 3 * HOUR)

    salon = draft_record(
        db,
        company("c-bg-salon"),
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
    apply_decision(
        db,
        salon,
        DecisionInput("MANUAL_REVIEW", ["Средний балл скоринга", "Короткие просрочки в кредитной истории"]),
        "SYSTEM",
        SYSTEM_ACTOR,
        run_pipeline(db, salon, salon_start, 20_000, "Гарипова Лилия Рустамовна"),
    )
    seed_assign(db, salon, "u-underwriter2", salon_start + 20 * MINUTE)

    logistic = draft_record(
        db,
        company("c-bg-logistic"),
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
    logistic_review = run_pipeline(db, logistic, logistic_start, 30_000, "Зайцев Роман Олегович")
    apply_decision(
        db, logistic, DecisionInput("MANUAL_REVIEW", review_threshold_reason()), "SYSTEM", SYSTEM_ACTOR, logistic_review
    )
    apply_decision(
        db,
        logistic,
        DecisionInput(
            "APPROVED",
            ["Сильные финансовые показатели", "Залог — приобретаемая техника"],
            rate=17.5,
            comment="Одобрено, ставка снижена с учётом залога",
        ),
        "UNDERWRITER",
        UNDERWRITER_NAME,
        logistic_review + 7 * HOUR,
    )
    seed_assign(db, logistic, "u-underwriter", logistic_review + HOUR)
    seed_decision(db, logistic, "u-underwriter", logistic_review + 7 * HOUR)
    sign_and_disburse(db, logistic, logistic_review + 30 * HOUR, "Зайцев Роман Олегович")

    green = draft_record(
        db,
        company("c-bg-green"),
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
    green_decision = run_pipeline(db, green, green_start, 25_000, "Полякова Марина Игоревна")
    green_reasons = green.recommendation.reasons if green.recommendation else ["Низкий балл скоринга"]
    apply_decision(db, green, DecisionInput("REJECTED", green_reasons), "SYSTEM", SYSTEM_ACTOR, green_decision)

    media = draft_record(
        db,
        company("c-bg-media"),
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
    media_review = run_pipeline(db, media, media_start, 30_000, "Тихонов Артём Сергеевич")
    apply_decision(
        db, media, DecisionInput("MANUAL_REVIEW", review_threshold_reason()), "SYSTEM", SYSTEM_ACTOR, media_review
    )
    apply_decision(
        db,
        media,
        DecisionInput(
            "NEED_INFO",
            ["Нужны подтверждающие документы по контракту"],
            items=[
                InfoRequestItem(code="statement_6m", label="Выписка по счёту за 6 месяцев", type="document"),
                InfoRequestItem(code="tax_return", label="Налоговая декларация за последний период", type="document"),
            ],
            comment="Приложите выписку и декларацию — по контракту крупные авансы.",
        ),
        "UNDERWRITER",
        UNDERWRITER_NAME,
        media_review + 5 * HOUR,
    )
    seed_assign(db, media, "u-underwriter", media_review + HOUR)
    seed_decision(db, media, "u-underwriter", media_review + 5 * HOUR)

    coffee = draft_record(
        db,
        company("c-bg-coffee"),
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
    apply_decision(
        db,
        coffee,
        DecisionInput("APPROVED", ["Обороты по счёту растут или стабильны", "Кредитная история без просрочек"], rate=18),
        "SYSTEM",
        SYSTEM_ACTOR,
        run_pipeline(db, coffee, coffee_start, 20_000, "Соколова Евгения Андреевна"),
    )

    db.notifications = []
    contract_number = history.app.contract.number if history.app.contract else ""
    disbursed_ms = parse_ms(history.disbursed_at) if history.disbursed_at else now - 150 * DAY
    seed_notification(
        db,
        "u-client1",
        "DISBURSED",
        "Средства зачислены на расчётный счёт",
        f"1 500 000 ₽ по договору {contract_number}. График платежей — в карточке заявки.",
        disbursed_ms,
        True,
        history.app.id,
    )
    seed_notification(
        db,
        "u-client1",
        "CONTRACT_READY",
        "Договор готов к подписанию",
        "Проверьте условия и подтвердите подписание кодом.",
        disbursed_ms - 2 * HOUR,
        True,
        history.app.id,
    )
    seed_notification(
        db,
        "u-client3",
        "APPLICATION_SUBMITTED",
        "Заявка отправлена",
        f"Заявка {review.app.number} принята банком.",
        review_start,
        True,
        review.app.id,
    )
    seed_notification(
        db,
        "u-client3",
        "DECISION_MADE",
        "Заявка передана специалисту",
        "Кредитный специалист изучит заявку. Обычно это занимает до 1 рабочего дня.",
        review_decision,
        False,
        review.app.id,
    )
    return db
