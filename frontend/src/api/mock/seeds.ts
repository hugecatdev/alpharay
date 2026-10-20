import type {
  ActiveLoan,
  AppDocument,
  AppNotification,
  BkiData,
  Company,
  DocumentKind,
  Product,
  PurposeType,
  TurnoverMonth,
} from '@/api/types'
import type { ClientKey, MockApplication, MockCompany, MockDb, MockUser } from './db'
import { companyLoans, derivedFinancials } from './insights'
import { applyDecision, computeAssessment, setStatus, submitApplication, SYSTEM_ACTOR } from './pipeline'
import { addMonths, DAY, HOUR, iso, MINUTE, monthKey, uid } from './utils'

export const DB_VERSION = 5

export const UNDERWRITER_NAME = 'Ковалёва Ирина Михайловна'

export const PRODUCTS: Product[] = [
  {
    code: 'OVERDRAFT',
    name: 'Овердрафт для бизнеса',
    description:
      'Деньги на расчётном счёте, когда выручка ещё не пришла: оплачивайте поставщиков, аренду и налоги без кассовых разрывов. Погашение — по мере поступления выручки.',
    min_amount: 100_000,
    max_amount: 5_000_000,
    min_term: 1,
    max_term: 12,
    base_rate: 17.5,
    purpose_types: ['CASH_GAP'],
    requires_invoice: false,
  },
  {
    code: 'WORKING_CAPITAL',
    name: 'Оборотный кредит',
    description:
      'Пополнение оборотных средств: закупка товара, сырья и материалов, подготовка к сезону, крупный заказ. Равные ежемесячные платежи.',
    min_amount: 300_000,
    max_amount: 15_000_000,
    min_term: 3,
    max_term: 36,
    base_rate: 19.5,
    purpose_types: ['WORKING_CAPITAL', 'CASH_GAP'],
    requires_invoice: false,
  },
  {
    code: 'EQUIPMENT',
    name: 'Кредит на оборудование',
    description:
      'Покупка нового или б/у оборудования, техники и транспорта. Длинный срок — комфортный платёж. Понадобится счёт или договор поставщика.',
    min_amount: 500_000,
    max_amount: 30_000_000,
    min_term: 12,
    max_term: 60,
    base_rate: 18,
    purpose_types: ['EQUIPMENT'],
    requires_invoice: true,
  },
]

function noise(index: number, seed: number): number {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return value - Math.floor(value) - 0.5
}

function buildTurnover(
  now: number,
  months: number,
  fn: (index: number, calendarMonth: number) => { inflow: number; outflow: number },
): TurnoverMonth[] {
  const current = new Date(now)
  const rows: TurnoverMonth[] = []
  for (let offset = months; offset >= 1; offset -= 1) {
    const date = new Date(current.getFullYear(), current.getMonth() - offset, 1)
    const index = months - offset
    const { inflow, outflow } = fn(index, date.getMonth())
    rows.push({ month: monthKey(date), inflow: Math.round(inflow / 1000) * 1000, outflow: Math.round(outflow / 1000) * 1000 })
  }
  return rows
}

const BAKERY_SEASON = [0.86, 0.84, 0.9, 0.94, 0.98, 0.93, 0.9, 0.92, 1.0, 1.04, 1.1, 1.42]

interface CompanyInput {
  key: ClientKey
  id: string
  company: Omit<Company, 'id'>
  egrulStatus?: string
  fns: { tax_debt: number; account_blocks: boolean; mass_address: boolean; disqualified_head: boolean; revenueFactor: number }
  bki: BkiData
  turnover: TurnoverMonth[]
  external_loans: ActiveLoan[]
}

function makeCompany(input: CompanyInput): MockCompany {
  const company: Company = { id: input.id, ...input.company }
  const revenue = input.turnover.reduce((sum, month) => sum + month.inflow, 0)
  return {
    key: input.key,
    company,
    egrul: {
      status: input.egrulStatus ?? 'Действующее',
      ogrn: company.ogrn,
      registration_date: company.registration_date,
      okved_main: company.okved_main,
      okved_name: company.okved_name,
      head_name: company.head_name,
      address: company.address,
    },
    fns: {
      tax_debt: input.fns.tax_debt,
      account_blocks: input.fns.account_blocks,
      mass_address: input.fns.mass_address,
      disqualified_head: input.fns.disqualified_head,
      declared_revenue_12m: Math.round((revenue * input.fns.revenueFactor) / 1000) * 1000,
    },
    bki: input.bki,
    turnover: input.turnover,
    external_loans: input.external_loans,
  }
}

function demoCompanies(now: number): MockCompany[] {
  const bakery = buildTurnover(now, 12, (index, month) => {
    const season = BAKERY_SEASON[month]
    const inflow = 3_050_000 * (1 + 0.012 * index) * season * (1 + noise(index, 1) * 0.04)
    const outflow = inflow * (0.86 - (season - 1) * 0.15) * (1 + noise(index, 2) * 0.02)
    return { inflow, outflow }
  })
  const young = buildTurnover(now, 8, (index) => {
    const inflow = 260_000 * Math.pow(1.18, index) * (1 + noise(index, 3) * 0.06)
    return { inflow, outflow: inflow * (0.84 + noise(index, 4) * 0.04) }
  })
  const volatileMultipliers = [1.2, 0.7, 1.35, 0.85, 1.1, 0.6, 1.4, 0.9, 0.75, 1.25, 0.95, 0.8]
  const construction = buildTurnover(now, 12, (index) => {
    const trend = 1 - 0.01 * index
    const inflow = 2_600_000 * trend * volatileMultipliers[index]
    const outflow = 2_600_000 * 0.93 * trend * (0.9 + 0.1 * volatileMultipliers[index])
    return { inflow, outflow }
  })
  const declining = buildTurnover(now, 12, (index) => {
    const inflow = 2_500_000 * Math.pow(0.95, index) * (1 + noise(index, 5) * 0.05)
    return { inflow, outflow: inflow * (1.03 + noise(index, 6) * 0.02) }
  })
  const stable = buildTurnover(now, 12, (index) => {
    const inflow = 2_000_000 * (1 + 0.005 * index) * (1 + noise(index, 7) * 0.08)
    return { inflow, outflow: inflow * (0.82 + noise(index, 8) * 0.03) }
  })

  return [
    makeCompany({
      key: 'client1',
      id: 'c-client1',
      company: {
        inn: '7714382915',
        ogrn: '1187746512340',
        name: 'ООО «Пекарня Ветер»',
        legal_form: 'OOO',
        registration_date: '2018-03-14',
        okved_main: '10.71',
        okved_name: 'Производство хлеба и мучных кондитерских изделий недлительного хранения',
        address: 'г. Москва, ул. Верхняя Масловка, д. 20, стр. 2',
        head_name: 'Ветрова Анна Сергеевна',
        tax_system: 'USN_15',
        employees_count: 34,
      },
      fns: { tax_debt: 0, account_blocks: false, mass_address: false, disqualified_head: false, revenueFactor: 0.97 },
      bki: {
        rating: 872,
        rating_label: 'Высокий',
        active_loans: [
          { creditor: 'AlphaRay Банк', amount: 1_500_000, balance: 640_000, opened_at: iso(now - 150 * DAY), closed_at: null, max_overdue_days: 0 },
        ],
        closed_loans: [
          { creditor: 'ООО «Лизинг-Центр»', amount: 2_800_000, balance: 0, opened_at: '2020-02-10T00:00:00.000Z', closed_at: '2023-02-10T00:00:00.000Z', max_overdue_days: 0 },
          { creditor: 'Банк «Северный»', amount: 1_000_000, balance: 0, opened_at: '2021-09-01T00:00:00.000Z', closed_at: '2022-09-01T00:00:00.000Z', max_overdue_days: 0 },
        ],
        max_overdue_days_24m: 0,
      },
      turnover: bakery,
      external_loans: [],
    }),
    makeCompany({
      key: 'client2',
      id: 'c-client2',
      company: {
        inn: '502913648207',
        ogrn: '326502700041852',
        name: 'ИП Смирнов А.В.',
        legal_form: 'IP',
        registration_date: iso(addMonths(now, -8)).slice(0, 10),
        okved_main: '47.91',
        okved_name: 'Торговля розничная по почте или по информационно-коммуникационной сети Интернет',
        address: 'Московская обл., г. Химки, ул. Молодёжная, д. 12, кв. 48',
        head_name: 'Смирнов Алексей Викторович',
        tax_system: 'USN_6',
        employees_count: 2,
      },
      fns: { tax_debt: 0, account_blocks: false, mass_address: false, disqualified_head: false, revenueFactor: 0.95 },
      bki: { rating: 640, rating_label: 'Средний — короткая история', active_loans: [], closed_loans: [], max_overdue_days_24m: 0 },
      turnover: young,
      external_loans: [],
    }),
    makeCompany({
      key: 'client3',
      id: 'c-client3',
      company: {
        inn: '5260417832',
        ogrn: '1155260003418',
        name: 'ООО «СтройМастер»',
        legal_form: 'OOO',
        registration_date: '2015-06-02',
        okved_main: '41.20',
        okved_name: 'Строительство жилых и нежилых зданий',
        address: 'г. Нижний Новгород, ул. Ларина, д. 7, офис 305',
        head_name: 'Кравцов Игорь Петрович',
        tax_system: 'OSN',
        employees_count: 58,
      },
      fns: { tax_debt: 0, account_blocks: false, mass_address: false, disqualified_head: false, revenueFactor: 1.02 },
      bki: {
        rating: 520,
        rating_label: 'Ниже среднего',
        active_loans: [
          { creditor: 'Банк «Волга-Кредит»', amount: 9_000_000, balance: 5_200_000, opened_at: iso(now - 420 * DAY), closed_at: null, max_overdue_days: 45 },
        ],
        closed_loans: [
          { creditor: 'ООО «Лизинг-Центр»', amount: 4_500_000, balance: 0, opened_at: '2019-05-20T00:00:00.000Z', closed_at: '2022-05-20T00:00:00.000Z', max_overdue_days: 12 },
        ],
        max_overdue_days_24m: 45,
      },
      turnover: construction,
      external_loans: [
        {
          id: 'ext-c3-1',
          contract_number: 'ВК-2025-01187',
          product_name: 'Кредит на пополнение оборотных средств (Банк «Волга-Кредит»)',
          amount: 9_000_000,
          balance: 5_200_000,
          rate: 21.5,
          monthly_payment: 420_000,
          next_payment_date: iso(now + 9 * DAY),
          issued_at: iso(now - 420 * DAY),
          maturity_date: iso(now + 400 * DAY),
        },
      ],
    }),
    makeCompany({
      key: 'client4',
      id: 'c-client4',
      company: {
        inn: '7728519364',
        ogrn: '1167746893215',
        name: 'ООО «Радуга Трейд»',
        legal_form: 'OOO',
        registration_date: '2016-09-20',
        okved_main: '46.49',
        okved_name: 'Торговля оптовая прочими бытовыми товарами',
        address: 'г. Москва, Варшавское ш., д. 125, стр. 1, офис 14',
        head_name: 'Гусейнов Тимур Рашидович',
        tax_system: 'OSN',
        employees_count: 12,
      },
      fns: { tax_debt: 312_000, account_blocks: true, mass_address: false, disqualified_head: false, revenueFactor: 0.99 },
      bki: {
        rating: 310,
        rating_label: 'Низкий',
        active_loans: [
          { creditor: 'Банк «Столичный»', amount: 2_500_000, balance: 1_900_000, opened_at: iso(now - 640 * DAY), closed_at: null, max_overdue_days: 203 },
        ],
        closed_loans: [],
        max_overdue_days_24m: 203,
      },
      turnover: declining,
      external_loans: [
        {
          id: 'ext-c4-1',
          contract_number: 'СТ-2024-55102',
          product_name: 'Кредит на развитие (Банк «Столичный»)',
          amount: 2_500_000,
          balance: 1_900_000,
          rate: 23,
          monthly_payment: 98_000,
          next_payment_date: iso(now + 4 * DAY),
          issued_at: iso(now - 640 * DAY),
          maturity_date: iso(now + 450 * DAY),
        },
      ],
    }),
    makeCompany({
      key: 'client5',
      id: 'c-client5',
      company: {
        inn: '7802615473',
        ogrn: '1177847201946',
        name: 'ООО «ТехноСервис»',
        legal_form: 'OOO',
        registration_date: '2017-04-11',
        okved_main: '62.02',
        okved_name: 'Деятельность консультативная и работы в области компьютерных технологий',
        address: 'г. Санкт-Петербург, Лиговский пр., д. 50, корп. 13',
        head_name: 'Орлов Денис Андреевич',
        tax_system: 'USN_15',
        employees_count: 21,
      },
      fns: { tax_debt: 0, account_blocks: false, mass_address: false, disqualified_head: false, revenueFactor: 0.74 },
      bki: {
        rating: 760,
        rating_label: 'Хороший',
        active_loans: [],
        closed_loans: [
          { creditor: 'Банк «Невский»', amount: 1_200_000, balance: 0, opened_at: '2021-03-01T00:00:00.000Z', closed_at: '2023-03-01T00:00:00.000Z', max_overdue_days: 0 },
        ],
        max_overdue_days_24m: 0,
      },
      turnover: stable,
      external_loans: [],
    }),
  ]
}

interface BackgroundInput {
  id: string
  name: string
  legal_form: 'OOO' | 'IP'
  inn: string
  ogrn: string
  registration_date: string
  okved_main: string
  okved_name: string
  address: string
  head_name: string
  base: number
  margin: number
  employees: number
  rating: number
  rating_label: string
  overdue: number
  tax_debt: number
  seed: number
}

function backgroundCompany(now: number, input: BackgroundInput): MockCompany {
  const turnover = buildTurnover(now, 12, (index) => {
    const inflow = input.base * (1 + 0.006 * index) * (1 + noise(index, input.seed) * 0.12)
    return { inflow, outflow: inflow * (1 - input.margin) * (1 + noise(index, input.seed + 1) * 0.03) }
  })
  return makeCompany({
    key: 'background',
    id: input.id,
    company: {
      inn: input.inn,
      ogrn: input.ogrn,
      name: input.name,
      legal_form: input.legal_form,
      registration_date: input.registration_date,
      okved_main: input.okved_main,
      okved_name: input.okved_name,
      address: input.address,
      head_name: input.head_name,
      tax_system: input.legal_form === 'IP' ? 'PATENT' : 'USN_15',
      employees_count: input.employees,
    },
    fns: { tax_debt: input.tax_debt, account_blocks: false, mass_address: false, disqualified_head: false, revenueFactor: 0.98 },
    bki: {
      rating: input.rating,
      rating_label: input.rating_label,
      active_loans: [],
      closed_loans: [],
      max_overdue_days_24m: input.overdue,
    },
    turnover,
    external_loans: [],
  })
}

function registryCompanies(now: number): MockCompany[] {
  const registered = iso(addMonths(now, -27)).slice(0, 10)
  const company: Company = {
    id: 'c-registry-petrov',
    inn: '771405283916',
    ogrn: '324774600218734',
    name: 'ИП Петров П.С.',
    legal_form: 'IP',
    registration_date: registered,
    okved_main: '56.10',
    okved_name: 'Деятельность ресторанов и услуги по доставке продуктов питания',
    address: 'г. Москва, ул. Бутырская, д. 46, пом. 2',
    head_name: 'Петров Павел Сергеевич',
    tax_system: 'USN_6',
    employees_count: 4,
  }
  return [
    {
      key: 'newcomer',
      company,
      egrul: {
        status: 'Действующее',
        ogrn: company.ogrn,
        registration_date: company.registration_date,
        okved_main: company.okved_main,
        okved_name: company.okved_name,
        head_name: company.head_name,
        address: company.address,
      },
      fns: { tax_debt: 0, account_blocks: false, mass_address: false, disqualified_head: false, declared_revenue_12m: 9_600_000 },
      bki: { rating: 690, rating_label: 'Средний', active_loans: [], closed_loans: [], max_overdue_days_24m: 0 },
      turnover: [],
      external_loans: [],
    },
  ]
}

function backgroundCompanies(now: number): MockCompany[] {
  return [
    backgroundCompany(now, {
      id: 'c-bg-honey',
      name: 'ООО «Северный Мёд»',
      legal_form: 'OOO',
      inn: '2901284573',
      ogrn: '1162901004127',
      registration_date: '2016-05-17',
      okved_main: '10.89',
      okved_name: 'Производство прочих пищевых продуктов',
      address: 'г. Архангельск, пр. Ломоносова, д. 81',
      head_name: 'Ершов Павел Константинович',
      base: 5_200_000,
      margin: 0.12,
      employees: 41,
      rating: 705,
      rating_label: 'Хороший',
      overdue: 8,
      tax_debt: 0,
      seed: 11,
    }),
    backgroundCompany(now, {
      id: 'c-bg-salon',
      name: 'ИП Гарипова Л.Р.',
      legal_form: 'IP',
      inn: '165904381276',
      ogrn: '319169000127834',
      registration_date: '2019-11-05',
      okved_main: '96.02',
      okved_name: 'Предоставление услуг парикмахерскими и салонами красоты',
      address: 'г. Казань, ул. Баумана, д. 44',
      head_name: 'Гарипова Лилия Рустамовна',
      base: 780_000,
      margin: 0.07,
      employees: 6,
      rating: 610,
      rating_label: 'Средний',
      overdue: 18,
      tax_debt: 0,
      seed: 13,
    }),
    backgroundCompany(now, {
      id: 'c-bg-logistic',
      name: 'ООО «Логистик-Юг»',
      legal_form: 'OOO',
      inn: '2311298460',
      ogrn: '1192375036514',
      registration_date: '2019-04-22',
      okved_main: '49.41',
      okved_name: 'Деятельность автомобильного грузового транспорта',
      address: 'г. Краснодар, ул. Уральская, д. 126',
      head_name: 'Зайцев Роман Олегович',
      base: 9_400_000,
      margin: 0.11,
      employees: 63,
      rating: 812,
      rating_label: 'Высокий',
      overdue: 0,
      tax_debt: 0,
      seed: 17,
    }),
    backgroundCompany(now, {
      id: 'c-bg-green',
      name: 'ООО «Зелёный Квартал»',
      legal_form: 'OOO',
      inn: '6671093825',
      ogrn: '1186658041932',
      registration_date: '2018-08-30',
      okved_main: '68.20',
      okved_name: 'Аренда и управление собственным или арендованным недвижимым имуществом',
      address: 'г. Екатеринбург, ул. Малышева, д. 51, офис 1102',
      head_name: 'Полякова Марина Игоревна',
      base: 1_300_000,
      margin: -0.02,
      employees: 5,
      rating: 390,
      rating_label: 'Низкий',
      overdue: 124,
      tax_debt: 87_400,
      seed: 19,
    }),
    backgroundCompany(now, {
      id: 'c-bg-media',
      name: 'ООО «Апельсин Медиа»',
      legal_form: 'OOO',
      inn: '7705982316',
      ogrn: '1207700318245',
      registration_date: '2020-07-14',
      okved_main: '73.11',
      okved_name: 'Деятельность рекламных агентств',
      address: 'г. Москва, ул. Большая Ордынка, д. 40, стр. 4',
      head_name: 'Тихонов Артём Сергеевич',
      base: 3_100_000,
      margin: 0.09,
      employees: 17,
      rating: 668,
      rating_label: 'Средний',
      overdue: 0,
      tax_debt: 0,
      seed: 23,
    }),
    backgroundCompany(now, {
      id: 'c-bg-coffee',
      name: 'ООО «Кофейня Зерно»',
      legal_form: 'OOO',
      inn: '7106539184',
      ogrn: '1177154012683',
      registration_date: '2017-10-02',
      okved_main: '56.10',
      okved_name: 'Деятельность ресторанов и услуги по доставке продуктов питания',
      address: 'г. Тула, пр. Ленина, д. 33',
      head_name: 'Соколова Евгения Андреевна',
      base: 1_900_000,
      margin: 0.14,
      employees: 14,
      rating: 798,
      rating_label: 'Хороший',
      overdue: 0,
      tax_debt: 0,
      seed: 29,
    }),
  ]
}

function users(): MockUser[] {
  return [
    {
      id: 'u-client1',
      email: 'client1@demo.local',
      password: 'demo',
      full_name: 'Ветрова Анна Сергеевна',
      role: 'CLIENT',
      position: 'Генеральный директор, собственник',
      company_id: 'c-client1',
    },
    {
      id: 'u-client2',
      email: 'client2@demo.local',
      password: 'demo',
      full_name: 'Смирнов Алексей Викторович',
      role: 'CLIENT',
      position: 'Индивидуальный предприниматель',
      company_id: 'c-client2',
    },
    {
      id: 'u-client3',
      email: 'client3@demo.local',
      password: 'demo',
      full_name: 'Лебедева Ольга Николаевна',
      role: 'CLIENT',
      position: 'Главный бухгалтер',
      company_id: 'c-client3',
    },
    {
      id: 'u-client4',
      email: 'client4@demo.local',
      password: 'demo',
      full_name: 'Гусейнов Тимур Рашидович',
      role: 'CLIENT',
      position: 'Генеральный директор',
      company_id: 'c-client4',
    },
    {
      id: 'u-client5',
      email: 'client5@demo.local',
      password: 'demo',
      full_name: 'Орлов Денис Андреевич',
      role: 'CLIENT',
      position: 'Генеральный директор',
      company_id: 'c-client5',
    },
    {
      id: 'u-client6',
      email: 'client6@demo.local',
      password: 'demo',
      full_name: 'Петров Павел Сергеевич',
      role: 'CLIENT',
      position: 'Предприниматель',
      company_id: null,
    },
    {
      id: 'u-underwriter',
      email: 'underwriter@bank.local',
      password: 'demo',
      full_name: UNDERWRITER_NAME,
      role: 'UNDERWRITER',
      position: 'Кредитный аналитик',
      company_id: null,
    },
  ]
}

interface DraftInput {
  mc: MockCompany
  userId: string | null
  productCode: string
  amount: number
  term: number
  purpose: string
  purposeType: PurposeType
  createdAt: number
}

function documentFor(kind: DocumentKind, filename: string, size: number, at: number): AppDocument {
  return { id: uid(), kind, filename, size, created_at: iso(at) }
}

function draftRecord(db: MockDb, input: DraftInput): MockApplication {
  const product = PRODUCTS.find((item) => item.code === input.productCode) ?? PRODUCTS[1]
  db.counter += 1
  const record: MockApplication = {
    app: {
      id: uid(),
      number: `КР-2026-${String(db.counter).padStart(6, '0')}`,
      status: 'DRAFT',
      product,
      amount: input.amount,
      term: input.term,
      purpose: input.purpose,
      purpose_type: input.purposeType,
      company: input.mc.company,
      company_confirmed: false,
      financials: null,
      documents: [],
      consents: { bki: false, personal_data: false, risks: false },
      offer: null,
      info_request: null,
      decision: null,
      contract: null,
      created_at: iso(input.createdAt),
      submitted_at: null,
      updated_at: iso(input.createdAt),
    },
    company_id: input.mc.company.id,
    user_id: input.userId,
    scoring: null,
    recommendation: null,
    enriched: false,
    assigned_to: null,
    stage_entered_at: input.createdAt,
    mock_fail: false,
    mock_fail_event_done: false,
    info_round: 0,
    info_answers: [],
    disburse_at: null,
    disbursed_at: null,
  }
  db.applications.push(record)
  db.events.push({
    id: uid(),
    application_id: record.app.id,
    from_status: null,
    to_status: 'DRAFT',
    actor_type: 'CLIENT',
    actor_name: input.userId ? db.users.find((user) => user.id === input.userId)?.full_name ?? 'Клиент' : input.mc.company.head_name,
    reason: 'Создан черновик заявки',
    created_at: iso(input.createdAt),
  })
  return record
}

function prepareForSubmit(db: MockDb, record: MockApplication, at: number, documents: AppDocument[]): void {
  const mc = db.companies.find((item) => item.company.id === record.company_id)
  if (!mc) return
  record.app.company_confirmed = true
  record.app.financials = derivedFinancials(db, mc, at)
  record.app.documents = documents
  record.app.consents = { bki: true, personal_data: true, risks: true }
}

function runPipeline(db: MockDb, record: MockApplication, start: number, step: number, actorName: string): number {
  submitApplication(db, record, actorName, start, false)
  setStatus(db, record, 'VALIDATING', start + step, 'SYSTEM', SYSTEM_ACTOR, 'Заявка принята в обработку')
  setStatus(db, record, 'ENRICHING', start + step * 2, 'SYSTEM', SYSTEM_ACTOR, 'Проверка полноты и корректности пройдена')
  computeAssessment(db, record, start + step * 3)
  setStatus(db, record, 'SCORING', start + step * 3, 'SYSTEM', SYSTEM_ACTOR, 'Получены данные ЕГРЮЛ, ФНС и БКИ')
  setStatus(db, record, 'DECIDING', start + step * 4, 'SYSTEM', SYSTEM_ACTOR, 'Скоринговая оценка рассчитана')
  return start + step * 5
}

function signAndDisburse(db: MockDb, record: MockApplication, signAt: number, actorName: string): void {
  setStatus(db, record, 'SIGNING', signAt, 'CLIENT', actorName, 'Запрошен код подтверждения')
  setStatus(db, record, 'SIGNED', signAt + 3 * MINUTE, 'CLIENT', actorName, 'Договор подписан простой электронной подписью')
  if (record.app.contract) record.app.contract.signed_at = iso(signAt + 3 * MINUTE)
  if (record.app.offer) record.app.offer.status = 'ACCEPTED'
  const disbursedAt = signAt + 2 * HOUR
  setStatus(db, record, 'DISBURSED', disbursedAt, 'SYSTEM', SYSTEM_ACTOR, 'Средства перечислены на расчётный счёт')
  record.disbursed_at = iso(disbursedAt)
}

function seedNotification(
  db: MockDb,
  userId: string,
  type: AppNotification['type'],
  title: string,
  body: string,
  at: number,
  isRead: boolean,
  applicationId: string | null,
): void {
  db.notifications.push({ id: uid(), user_id: userId, application_id: applicationId, type, title, body, is_read: isRead, created_at: iso(at) })
}

export function createSeed(now: number): MockDb {
  const db: MockDb = {
    version: DB_VERSION,
    seeded_at: now,
    counter: 1200,
    users: users(),
    companies: [...demoCompanies(now), ...registryCompanies(now), ...backgroundCompanies(now)],
    products: PRODUCTS,
    applications: [],
    events: [],
    notifications: [],
    sessions: [],
  }
  const company = (id: string) => {
    const found = db.companies.find((item) => item.company.id === id)
    if (!found) throw new Error(`Seed company ${id} not found`)
    return found
  }

  const c1 = company('c-client1')
  const history = draftRecord(db, {
    mc: c1,
    userId: 'u-client1',
    productCode: 'WORKING_CAPITAL',
    amount: 1_500_000,
    term: 12,
    purpose: 'Закупка муки и упаковки к новогоднему сезону',
    purposeType: 'WORKING_CAPITAL',
    createdAt: now - 152 * DAY - 40 * MINUTE,
  })
  const historyStart = now - 152 * DAY
  prepareForSubmit(db, history, historyStart, [
    documentFor('BANK_STATEMENT', 'Выписка_по_счёту_12_мес.pdf', 482_133, historyStart - 10 * MINUTE),
  ])
  const historyDecision = runPipeline(db, history, historyStart, 40_000, 'Ветрова Анна Сергеевна')
  applyDecision(db, history, { type: 'APPROVED', rate: 19.5, reasons: ['Высокий балл скоринга', 'Нет стоп-факторов'] }, 'SYSTEM', SYSTEM_ACTOR, historyDecision)
  signAndDisburse(db, history, historyDecision + 20 * HOUR, 'Ветрова Анна Сергеевна')
  const ownLoan = companyLoans(db, c1, now).find((loan) => loan.id === history.app.id)
  if (ownLoan && c1.bki.active_loans[0]) c1.bki.active_loans[0].balance = ownLoan.balance

  const draft = draftRecord(db, {
    mc: c1,
    userId: 'u-client1',
    productCode: 'EQUIPMENT',
    amount: 2_400_000,
    term: 36,
    purpose: 'Покупка печи и тестомеса',
    purposeType: 'EQUIPMENT',
    createdAt: now - 2 * DAY,
  })
  draft.app.company_confirmed = true

  const c3 = company('c-client3')
  const review = draftRecord(db, {
    mc: c3,
    userId: 'u-client3',
    productCode: 'WORKING_CAPITAL',
    amount: 4_000_000,
    term: 24,
    purpose: 'Закупка стройматериалов для второй очереди жилого комплекса',
    purposeType: 'WORKING_CAPITAL',
    createdAt: now - 4 * HOUR,
  })
  const reviewStart = now - 3 * HOUR - 5 * MINUTE
  prepareForSubmit(db, review, reviewStart, [
    documentFor('BANK_STATEMENT', 'Выписка_СтройМастер_2026.pdf', 731_520, reviewStart - 5 * MINUTE),
    documentFor('TAX_RETURN', 'Декларация_НДС_2кв.pdf', 214_908, reviewStart - 4 * MINUTE),
  ])
  const reviewDecision = runPipeline(db, review, reviewStart, 30_000, 'Лебедева Ольга Николаевна')
  applyDecision(
    db,
    review,
    { type: 'MANUAL_REVIEW', reasons: ['В кредитной истории есть просрочка 45 дней', 'Нужна экспертная оценка специалиста'] },
    'SYSTEM',
    SYSTEM_ACTOR,
    reviewDecision,
  )

  const honey = draftRecord(db, {
    mc: company('c-bg-honey'),
    userId: null,
    productCode: 'EQUIPMENT',
    amount: 7_500_000,
    term: 48,
    purpose: 'Линия фасовки мёда и холодильная камера',
    purposeType: 'EQUIPMENT',
    createdAt: now - 27 * HOUR,
  })
  const honeyStart = now - 26 * HOUR
  prepareForSubmit(db, honey, honeyStart, [
    documentFor('EQUIPMENT_INVOICE', 'Счёт_линия_фасовки.pdf', 318_400, honeyStart - 20 * MINUTE),
    documentFor('BANK_STATEMENT', 'Выписка_12_мес.pdf', 528_771, honeyStart - 19 * MINUTE),
  ])
  applyDecision(
    db,
    honey,
    { type: 'MANUAL_REVIEW', reasons: ['Сумма выше порога автоматического решения 5 000 000 ₽'] },
    'SYSTEM',
    SYSTEM_ACTOR,
    runPipeline(db, honey, honeyStart, 35_000, 'Ершов Павел Константинович'),
  )
  honey.assigned_to = UNDERWRITER_NAME

  const salon = draftRecord(db, {
    mc: company('c-bg-salon'),
    userId: null,
    productCode: 'OVERDRAFT',
    amount: 900_000,
    term: 9,
    purpose: 'Оплата аренды и закупка расходных материалов до поступления выручки',
    purposeType: 'CASH_GAP',
    createdAt: now - 70 * MINUTE,
  })
  const salonStart = now - 55 * MINUTE
  prepareForSubmit(db, salon, salonStart, [documentFor('BANK_STATEMENT', 'Выписка_ИП.pdf', 190_442, salonStart - 3 * MINUTE)])
  applyDecision(
    db,
    salon,
    { type: 'MANUAL_REVIEW', reasons: ['Средний балл скоринга', 'Короткие просрочки в кредитной истории'] },
    'SYSTEM',
    SYSTEM_ACTOR,
    runPipeline(db, salon, salonStart, 20_000, 'Гарипова Лилия Рустамовна'),
  )

  const logistic = draftRecord(db, {
    mc: company('c-bg-logistic'),
    userId: null,
    productCode: 'EQUIPMENT',
    amount: 12_000_000,
    term: 48,
    purpose: 'Покупка двух седельных тягачей',
    purposeType: 'EQUIPMENT',
    createdAt: now - 15 * DAY,
  })
  const logisticStart = now - 14 * DAY
  prepareForSubmit(db, logistic, logisticStart, [
    documentFor('EQUIPMENT_INVOICE', 'Счёт_тягачи.pdf', 402_115, logisticStart - HOUR),
    documentFor('BANK_STATEMENT', 'Выписка_Логистик.pdf', 912_004, logisticStart - HOUR),
  ])
  const logisticReview = runPipeline(db, logistic, logisticStart, 30_000, 'Зайцев Роман Олегович')
  applyDecision(db, logistic, { type: 'MANUAL_REVIEW', reasons: ['Сумма выше порога автоматического решения 5 000 000 ₽'] }, 'SYSTEM', SYSTEM_ACTOR, logisticReview)
  applyDecision(
    db,
    logistic,
    { type: 'APPROVED', rate: 17.5, reasons: ['Сильные финансовые показатели', 'Залог — приобретаемая техника'], comment: 'Одобрено, ставка снижена с учётом залога' },
    'UNDERWRITER',
    UNDERWRITER_NAME,
    logisticReview + 7 * HOUR,
  )
  signAndDisburse(db, logistic, logisticReview + 30 * HOUR, 'Зайцев Роман Олегович')

  const green = draftRecord(db, {
    mc: company('c-bg-green'),
    userId: null,
    productCode: 'WORKING_CAPITAL',
    amount: 3_000_000,
    term: 24,
    purpose: 'Ремонт арендуемых помещений',
    purposeType: 'WORKING_CAPITAL',
    createdAt: now - 5 * DAY - HOUR,
  })
  const greenStart = now - 5 * DAY
  prepareForSubmit(db, green, greenStart, [])
  const greenDecision = runPipeline(db, green, greenStart, 25_000, 'Полякова Марина Игоревна')
  applyDecision(db, green, { type: 'REJECTED', reasons: green.recommendation?.reasons ?? ['Низкий балл скоринга'] }, 'SYSTEM', SYSTEM_ACTOR, greenDecision)

  const media = draftRecord(db, {
    mc: company('c-bg-media'),
    userId: null,
    productCode: 'WORKING_CAPITAL',
    amount: 5_800_000,
    term: 18,
    purpose: 'Предоплата подрядчикам по крупному контракту',
    purposeType: 'WORKING_CAPITAL',
    createdAt: now - 2 * DAY - 2 * HOUR,
  })
  const mediaStart = now - 2 * DAY
  prepareForSubmit(db, media, mediaStart, [documentFor('BANK_STATEMENT', 'Выписка_Апельсин.pdf', 377_210, mediaStart - 10 * MINUTE)])
  const mediaReview = runPipeline(db, media, mediaStart, 30_000, 'Тихонов Артём Сергеевич')
  applyDecision(db, media, { type: 'MANUAL_REVIEW', reasons: ['Сумма выше порога автоматического решения 5 000 000 ₽'] }, 'SYSTEM', SYSTEM_ACTOR, mediaReview)
  applyDecision(
    db,
    media,
    {
      type: 'NEED_INFO',
      items: [
        { code: 'statement_6m', label: 'Выписка по счёту за 6 месяцев', type: 'document' },
        { code: 'tax_return', label: 'Налоговая декларация за последний период', type: 'document' },
      ],
      reasons: ['Нужны подтверждающие документы по контракту'],
      comment: 'Приложите выписку и декларацию — по контракту крупные авансы.',
    },
    'UNDERWRITER',
    UNDERWRITER_NAME,
    mediaReview + 5 * HOUR,
  )
  media.assigned_to = UNDERWRITER_NAME

  const coffee = draftRecord(db, {
    mc: company('c-bg-coffee'),
    userId: null,
    productCode: 'EQUIPMENT',
    amount: 1_800_000,
    term: 36,
    purpose: 'Кофемашина и оборудование для второй точки',
    purposeType: 'EQUIPMENT',
    createdAt: now - DAY - 2 * HOUR,
  })
  const coffeeStart = now - DAY
  prepareForSubmit(db, coffee, coffeeStart, [documentFor('EQUIPMENT_INVOICE', 'Счёт_кофемашина.pdf', 156_880, coffeeStart - 5 * MINUTE)])
  applyDecision(
    db,
    coffee,
    { type: 'APPROVED', rate: 18, reasons: ['Высокий балл скоринга', 'Нет стоп-факторов'] },
    'SYSTEM',
    SYSTEM_ACTOR,
    runPipeline(db, coffee, coffeeStart, 20_000, 'Соколова Евгения Андреевна'),
  )

  db.notifications = []
  const historyDisbursed = history.disbursed_at ? new Date(history.disbursed_at).getTime() : now - 150 * DAY
  seedNotification(
    db,
    'u-client1',
    'DISBURSED',
    'Средства зачислены на расчётный счёт',
    `1 500 000 ₽ по договору ${history.app.contract?.number ?? ''}. График платежей — в карточке заявки.`,
    historyDisbursed,
    true,
    history.app.id,
  )
  seedNotification(
    db,
    'u-client1',
    'CONTRACT_READY',
    'Договор готов к подписанию',
    'Проверьте условия и подтвердите подписание кодом.',
    historyDisbursed - 2 * HOUR,
    true,
    history.app.id,
  )
  seedNotification(db, 'u-client3', 'APPLICATION_SUBMITTED', 'Заявка отправлена', `Заявка ${review.app.number} принята банком.`, reviewStart, true, review.app.id)
  seedNotification(
    db,
    'u-client3',
    'DECISION_MADE',
    'Заявка передана специалисту',
    'Кредитный специалист изучит заявку. Обычно это занимает до 1 рабочего дня.',
    reviewDecision,
    false,
    review.app.id,
  )
  return db
}
