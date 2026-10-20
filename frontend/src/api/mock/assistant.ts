import type { AssistantChatRequest, AssistantContext, AssistantHint, AssistantMessage, PurposeType } from '@/api/types'
import { loanSummary } from '@/shared/lib/annuity'
import { purposeLabels } from '@/shared/lib/labels'
import { statusMeta, isProcessing } from '@/shared/lib/statusMeta'
import { findApplication, findCompany, type MockApplication, type MockCompany, type MockDb, type MockUser } from './db'
import { avgFreeCashFlow, companyLoans, preApprovedLimit } from './insights'
import { findApplicationsOfCompany } from './queries'
import { SYSTEM_ACTOR } from './pipeline'
import { dateRu, iso, lowerFirst, money, moneyShort, percent, rateText, uid } from './utils'

interface Reply {
  content: string
  hints?: AssistantHint[]
  suggestions?: string[]
}

interface Ctx {
  db: MockDb
  user: MockUser
  mc: MockCompany | undefined
  context: AssistantContext
  record: MockApplication | undefined
  text: string
  now: number
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

function has(text: string, ...keys: string[]): boolean {
  return keys.some((key) => text.includes(normalize(key)))
}

function num(context: AssistantContext, key: string): number | null {
  const value = context.data[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function str(context: AssistantContext, key: string): string | null {
  const value = context.data[key]
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number') return String(value)
  return null
}

function onScreen(ctx: Ctx, ...screens: string[]): boolean {
  return screens.includes(ctx.context.screen)
}

function firstName(user: MockUser): string {
  const parts = user.full_name.split(/\s+/).filter(Boolean)
  return parts.length >= 3 ? parts[1] : parts[0] ?? ''
}

function latestRecord(ctx: Ctx, predicate: (record: MockApplication) => boolean): MockApplication | undefined {
  if (!ctx.mc) return undefined
  return findApplicationsOfCompany(ctx.db, ctx.mc.company.id)
    .filter(predicate)
    .sort((a, b) => b.app.updated_at.localeCompare(a.app.updated_at))[0]
}

interface LoanParams {
  amount: number
  term: number
  rate: number
  source: 'screen' | 'offer' | 'application'
}

function loanParams(ctx: Ctx): LoanParams | null {
  const amount = num(ctx.context, 'amount')
  const term = num(ctx.context, 'term')
  if (amount && term && !ctx.record) {
    const rate = num(ctx.context, 'rate') ?? ctx.db.products.find((item) => item.code === str(ctx.context, 'product_code'))?.base_rate ?? 19.5
    return { amount, term, rate, source: 'screen' }
  }
  const record = ctx.record ?? latestRecord(ctx, (item) => item.app.status !== 'CANCELLED')
  if (record?.app.offer) return { amount: record.app.offer.amount, term: record.app.offer.term, rate: record.app.offer.rate, source: 'offer' }
  if (record) return { amount: record.app.amount, term: record.app.term, rate: record.app.product.base_rate, source: 'application' }
  if (amount && term) return { amount, term, rate: num(ctx.context, 'rate') ?? 19.5, source: 'screen' }
  return null
}

function cashflowShare(ctx: Ctx, payment: number): number | null {
  const fromScreen = num(ctx.context, 'payment_share_of_cashflow')
  if (fromScreen !== null && !ctx.record) return fromScreen
  if (!ctx.mc) return null
  const fcf = avgFreeCashFlow(ctx.mc.turnover)
  if (fcf <= 0) return null
  return Math.round((payment / fcf) * 100)
}

function paymentReply(ctx: Ctx): Reply {
  const params = loanParams(ctx)
  const definition = has(ctx.text, 'что такое', 'что значит', 'это что')
  const intro = definition && has(ctx.text, 'переплат')
    ? '**Переплата** — это сумма процентов за весь срок: всё, что вы вернёте банку сверх полученных денег.\n\n'
    : ''
  if (!params) {
    return {
      content: `${intro}Чтобы посчитать платёж, задайте сумму и срок на шаге **«Сумма и срок»** новой заявки или в подборе продукта — расчёт обновляется сразу при движении ползунков.\n\nПлатёж аннуитетный: одинаковый каждый месяц, в начале срока большая часть уходит на проценты.`,
      hints: onScreen(ctx, 'dashboard') ? [{ target: 'new-application', label: 'Показать кнопку новой заявки' }] : [],
      suggestions: ['Какой продукт мне подходит?', 'Как рассчитан предварительный лимит?'],
    }
  }
  const summary = loanSummary(params.amount, params.term, params.rate)
  const share = cashflowShare(ctx, summary.monthly_payment)
  const source =
    params.source === 'offer' ? ' по условиям банка' : params.source === 'application' ? ' по параметрам заявки' : ''
  const lines = [
    `${intro}**Платёж${source} — ${money(summary.monthly_payment)} в месяц**: ${money(params.amount)} на ${params.term} мес. под ${rateText(params.rate)} годовых.`,
    '',
    `- Всего вернёте **${money(summary.total_payment)}**, переплата — **${money(summary.overpayment)}** (${percent((summary.overpayment / params.amount) * 100)} от суммы).`,
    '- Платёж одинаковый каждый месяц (аннуитет): сначала большая часть идёт на проценты, к концу срока — на основной долг.',
  ]
  if (share !== null) lines.push(`- Это примерно **${percent(share)}** вашего среднего свободного денежного потока.`)
  const hints: AssistantHint[] = []
  if (onScreen(ctx, 'wizard.amount')) {
    hints.push({ target: 'payment-summary', label: 'Показать расчёт платежа' }, { target: 'overpayment', label: 'Показать переплату' })
  } else if (onScreen(ctx, 'application') && ctx.record) {
    if (ctx.record.app.status === 'COUNTER_OFFER') hints.push({ target: 'counter-offer', label: 'Сравнить условия' })
    else if (ctx.record.app.status === 'DISBURSED') hints.push({ target: 'schedule', label: 'Показать график платежей' })
    else hints.push({ target: 'action-block', label: 'Показать условия' })
  }
  return {
    content: lines.join('\n'),
    hints,
    suggestions: ['Как снизить платёж?', 'Какие риски у этого кредита?', 'Что такое переплата?'].filter(
      (item) => !(definition && item === 'Что такое переплата?'),
    ),
  }
}

function lowerPaymentReply(ctx: Ctx): Reply {
  const params = loanParams(ctx)
  if (!params || params.source !== 'screen') {
    return {
      content:
        'Снизить платёж можно тремя способами:\n\n- **Увеличить срок** — платёж меньше, но переплата больше.\n- **Уменьшить сумму** — например, часть покупки оплатить из оборота.\n- **Выбрать продукт под цель** — у кредита на оборудование срок до 60 месяцев.\n\nПараметры меняются на шаге «Сумма и срок» — расчёт пересчитывается сразу.',
      suggestions: ['Сколько будет платёж?', 'Какие риски у этого кредита?'],
    }
  }
  const maxTerm = num(ctx.context, 'max_term') ?? params.term
  const minAmount = num(ctx.context, 'min_amount') ?? 0
  const current = loanSummary(params.amount, params.term, params.rate)
  const lines = [`Сейчас платёж **${money(current.monthly_payment)}**. Варианты:`, '']
  if (maxTerm > params.term) {
    const longer = loanSummary(params.amount, maxTerm, params.rate)
    lines.push(
      `- **Срок ${maxTerm} мес.** — платёж ${money(longer.monthly_payment)} (на ${money(current.monthly_payment - longer.monthly_payment)} меньше), но переплата вырастет до ${money(longer.overpayment)}.`,
    )
  }
  const reduced = Math.max(minAmount, Math.round((params.amount * 0.8) / 50_000) * 50_000)
  if (reduced < params.amount) {
    const smaller = loanSummary(reduced, params.term, params.rate)
    lines.push(`- **Сумма ${money(reduced)}** (−20%) — платёж ${money(smaller.monthly_payment)}, переплата ${money(smaller.overpayment)}.`)
  }
  lines.push('', 'Двигайте ползунки «Сумма» и «Срок» — расчёт и график обновятся сразу. Какой вариант выбрать, решаете вы.')
  return {
    content: lines.join('\n'),
    hints: [
      { target: 'term', label: 'Показать срок' },
      { target: 'amount', label: 'Показать сумму' },
    ],
    suggestions: ['Впишется ли платёж в мой поток?', 'Какие риски у этого кредита?'],
  }
}

function riskReply(ctx: Ctx): Reply {
  const params = loanParams(ctx)
  const lines = ['**Кредит — это обязательство, а не дополнительная выручка.** Платить нужно каждый месяц, даже если продажи упадут.', '']
  const hints: AssistantHint[] = []
  if (params) {
    const summary = loanSummary(params.amount, params.term, params.rate)
    const share = cashflowShare(ctx, summary.monthly_payment)
    lines.push(`- Платёж **${money(summary.monthly_payment)}** в месяц на ${params.term} мес.`)
    lines.push(`- Переплата за весь срок — **${money(summary.overpayment)}** (${percent((summary.overpayment / params.amount) * 100)} от суммы).`)
    if (share !== null) {
      lines.push(`- Платёж займёт около **${percent(share)}** среднего свободного денежного потока.`)
      lines.push(`- Если поток снизится на 30%, доля вырастет до **${percent(Math.round(share / 0.7))}**.`)
      lines.push('')
      if (share > 70) {
        lines.push('Это **высокая нагрузка**: в слабый месяц денег на платёж может не хватить. Безопаснее увеличить срок или уменьшить сумму.')
      } else if (share > 40) {
        lines.push('Нагрузка **заметная**. Заложите резерв минимум на 2–3 платежа и проверьте месяцы сезонного спада.')
      } else {
        lines.push('Нагрузка **умеренная**, но резерв на 2–3 платежа всё равно стоит держать на счёте.')
      }
    }
  } else if (ctx.mc) {
    lines.push(`- Средний свободный денежный поток компании — ${money(avgFreeCashFlow(ctx.mc.turnover))} в месяц. Безопасно, если платёж занимает не больше 40–50% этой суммы.`)
  }
  lines.push(
    '',
    'Что будет при просрочке:',
    '- начисляются пени за каждый день задержки;',
    '- просрочка попадает в бюро кредитных историй — следующие кредиты будет получить сложнее и дороже;',
    '- при длительной просрочке банк вправе потребовать досрочного погашения и взыскать долг.',
  )
  if (onScreen(ctx, 'wizard.amount')) {
    hints.push({ target: 'risk-warning', label: 'Показать предупреждение о рисках' }, { target: 'cashflow-fit', label: 'Впишется ли платёж' })
  } else if (onScreen(ctx, 'wizard.review')) {
    hints.push({ target: 'consent-risks', label: 'Показать подтверждение рисков' })
  }
  return {
    content: lines.join('\n'),
    hints,
    suggestions: ['Как снизить платёж?', 'Что будет, если выручка упадёт?', 'Что такое переплата?'],
  }
}

function nextStep(record: MockApplication): string {
  const app = record.app
  switch (app.status) {
    case 'DRAFT':
      return 'Заполните оставшиеся шаги и отправьте заявку — черновик сохраняется автоматически.'
    case 'MANUAL_REVIEW':
      return 'Специалист изучит заявку, обычно до 1 рабочего дня. Если понадобятся документы, запрос появится в карточке заявки и в уведомлениях.'
    case 'NEED_INFO':
      return `Ответьте на запрос банка в блоке «Что требуется от вас»: ${(app.info_request?.items ?? []).map((item) => item.label.toLowerCase()).join('; ')}. После ответа проверка продолжится автоматически.`
    case 'COUNTER_OFFER':
      return 'Сравните запрошенные и предложенные условия и нажмите «Принять» или «Отклонить» — решение только за вами.'
    case 'APPROVED':
      return 'Проверьте условия и перейдите к подписанию договора.'
    case 'SIGNING':
      return 'Подтвердите подписание кодом на странице договора.'
    case 'SIGNED':
      return 'Договор подписан — деньги поступят на расчётный счёт в ближайшее время.'
    case 'DISBURSED':
      return 'Деньги на счёте. График платежей — в карточке заявки, держите сумму платежа на счёте заранее.'
    case 'REJECTED':
      return 'Причины указаны в карточке заявки. Можно подобрать другой продукт или подать заявку позже, устранив причины.'
    case 'CLIENT_DECLINED':
    case 'CANCELLED':
      return 'Заявка закрыта. Новую можно подать в любой момент.'
    default:
      return 'Ничего делать не нужно: статус обновляется автоматически, автоматическая проверка обычно занимает меньше минуты.'
  }
}

function statusReply(ctx: Ctx): Reply {
  const record = ctx.record ?? latestRecord(ctx, (item) => item.app.status !== 'DRAFT')
  if (!record) {
    const drafts = ctx.mc ? findApplicationsOfCompany(ctx.db, ctx.mc.company.id).filter((item) => item.app.status === 'DRAFT') : []
    return {
      content: drafts.length
        ? `Отправленных заявок пока нет, но есть черновик **${drafts[0].app.number}** — ${drafts[0].app.product.name}, ${money(drafts[0].app.amount)}. Продолжите его в разделе «Мои заявки».`
        : 'У вас пока нет заявок. Начните с кнопки **«Новая заявка»** — сначала выберите цель и продукт, затем сумму и срок.',
      suggestions: ['Какой продукт мне подходит?', 'Сколько будет платёж?'],
    }
  }
  const app = record.app
  const meta = statusMeta[app.status]
  const lines = [
    `Заявка **${app.number}** — **${meta.title.toLowerCase()}**.`,
    '',
    meta.description,
    '',
    `**Что дальше:** ${nextStep(record)}`,
  ]
  if (isProcessing(app.status) && app.status !== 'MANUAL_REVIEW') {
    lines.push('', 'Этапы: проверка данных → запрос ЕГРЮЛ, ФНС и БКИ → оценка → решение. Каждый этап отмечается на шкале заявки.')
  }
  const hints: AssistantHint[] = []
  if (onScreen(ctx, 'application')) {
    hints.push({ target: 'timeline', label: 'Показать этапы заявки' })
    if (app.status === 'NEED_INFO') {
      hints.push({ target: 'info-request', label: 'Что нужно дополнить' })
      const first = app.info_request?.items[0]
      if (first) hints.push({ target: `info-${first.code}`, label: `Поле «${first.label}»` })
    } else if (app.status === 'COUNTER_OFFER') {
      hints.push({ target: 'counter-offer', label: 'Сравнить условия' })
    } else if (['APPROVED', 'SIGNING', 'REJECTED', 'DISBURSED'].includes(app.status)) {
      hints.push({ target: 'action-block', label: 'Что требуется от вас' })
    }
  }
  const suggestions =
    app.status === 'REJECTED' || app.status === 'COUNTER_OFFER'
      ? ['Почему такое решение?', 'Что делать дальше?']
      : app.status === 'DISBURSED'
        ? ['Сколько будет платёж?', 'Что будет при просрочке?']
        : ['Сколько ждать решения?', 'Что влияет на решение?']
  return { content: lines.join('\n'), hints, suggestions }
}

function factorSummary(record: MockApplication): string[] {
  const scoring = record.scoring
  if (!scoring) return []
  const strong = scoring.factors.filter((item) => item.points / item.max_points >= 0.7).map((item) => lowerFirst(item.name))
  const weak = scoring.factors.filter((item) => item.points / item.max_points <= 0.4)
  const lines: string[] = []
  if (strong.length) lines.push(`- **Сильные стороны:** ${strong.join(', ')}.`)
  if (weak.length) lines.push(`- **Что снижает оценку:** ${weak.map((item) => `${lowerFirst(item.name)} (${lowerFirst(item.comment)})`).join('; ')}.`)
  return lines
}

function decisionReply(ctx: Ctx): Reply {
  const record = ctx.record ?? latestRecord(ctx, (item) => item.app.decision !== null)
  if (!record || !record.app.decision) {
    return {
      content:
        'Решения по заявке пока нет. На решение влияют:\n\n- обороты и выручка относительно суммы кредита;\n- долговая нагрузка — сколько уже уходит на платежи;\n- платёжная дисциплина и кредитная история;\n- данные ЕГРЮЛ и ФНС: задолженности, блокировки счетов;\n- возраст бизнеса и динамика выручки.\n\nОценка ассистента не является решением банка.',
      suggestions: ['Что означает мой статус?', 'Сколько будет платёж?'],
    }
  }
  const app = record.app
  const decision = record.app.decision
  if (!decision) return statusReply(ctx)
  const author = decision.made_by === SYSTEM_ACTOR ? 'автоматический кредитный конвейер по правилам банка' : 'кредитный специалист банка'
  const lines: string[] = []
  const hints: AssistantHint[] = []

  if (app.status === 'COUNTER_OFFER' && app.offer) {
    const offer = app.offer
    lines.push(
      `Банк готов выдать кредит, но на других условиях. Решение принял ${author}.`,
      '',
      `- Запрошено: **${money(offer.requested.amount)}** на ${offer.requested.term} мес., платёж ${money(offer.requested.monthly_payment)}.`,
      `- Предложено: **${money(offer.amount)}** на ${offer.term} мес. под ${rateText(offer.rate)}, платёж ${money(offer.monthly_payment)}.`,
      `- Предложение действует до ${dateRu(offer.valid_until)}.`,
    )
    hints.push({ target: 'counter-offer', label: 'Сравнить условия' })
  } else if (app.status === 'REJECTED') {
    lines.push(`Банк не может выдать кредит на запрошенных условиях. Решение принял ${author}.`)
    hints.push({ target: 'decision-reasons', label: 'Показать причины' })
  } else if (app.status === 'NEED_INFO') {
    lines.push(`Банку не хватает данных для решения. Запрос сформировал ${author}.`)
    hints.push({ target: 'info-request', label: 'Что нужно дополнить' })
  } else if (app.status === 'MANUAL_REVIEW') {
    lines.push('Автоматической проверки недостаточно — заявку изучает специалист. Это не отказ: так бывает при крупной сумме или нестандартной ситуации.')
  } else {
    lines.push(`Решение: **${statusMeta[app.status].title.toLowerCase()}**. Его принял ${author}.`)
    if (app.offer) lines.push('', `Условия: ${money(app.offer.amount)} на ${app.offer.term} мес. под ${rateText(app.offer.rate)}, платёж ${money(app.offer.monthly_payment)}.`)
  }

  if (decision.reasons.length) {
    lines.push('', '**Причины:**', ...decision.reasons.map((reason) => `- ${reason}`))
  }
  const factors = factorSummary(record)
  if (factors.length) lines.push('', 'По результатам оценки:', ...factors)
  if (app.status === 'REJECTED') {
    lines.push(
      '',
      '**Что можно сделать:** устранить причины (погасить задолженности, закрыть просрочки), подать заявку через 2–3 месяца или выбрать меньшую сумму.',
    )
  }
  if (app.status === 'COUNTER_OFFER') lines.push('', 'Принять или отклонить предложение — ваше решение, кнопки в блоке «Что требуется от вас».')
  return {
    content: lines.join('\n'),
    hints: onScreen(ctx, 'application') ? hints : [],
    suggestions: app.status === 'COUNTER_OFFER' ? ['Сколько будет платёж?', 'Какие риски у этого кредита?'] : ['Что делать дальше?', 'Что означает мой статус?'],
  }
}

function productReply(ctx: Ctx): Reply {
  const [overdraft, working, equipment] = ['OVERDRAFT', 'WORKING_CAPITAL', 'EQUIPMENT'].map((code) =>
    ctx.db.products.find((item) => item.code === code),
  )
  const lines: string[] = []
  if (ctx.mc) {
    lines.push(`Для **${ctx.mc.company.name}** (средний свободный поток ${money(avgFreeCashFlow(ctx.mc.turnover))} в месяц):`, '')
  }
  if (overdraft) lines.push(`- **${overdraft.name}** — для кассовых разрывов: до ${moneyShort(overdraft.max_amount)}, до ${overdraft.max_term} мес., от ${rateText(overdraft.base_rate)}. Гасится из поступающей выручки.`)
  if (working) lines.push(`- **${working.name}** — закупка товара и сырья, подготовка к сезону: до ${moneyShort(working.max_amount)}, до ${working.max_term} мес., от ${rateText(working.base_rate)}.`)
  if (equipment) lines.push(`- **${equipment.name}** — техника и оборудование: до ${moneyShort(equipment.max_amount)}, до ${equipment.max_term} мес., от ${rateText(equipment.base_rate)}. Нужен счёт поставщика.`)
  const purpose = (str(ctx.context, 'purpose_type') ?? str(ctx.context, 'purpose')) as PurposeType | null
  if (purpose && purpose in purposeLabels) {
    const fit = ctx.db.products.find((item) => item.purpose_types[0] === purpose) ?? ctx.db.products.find((item) => item.purpose_types.includes(purpose))
    if (fit) lines.push('', `Под цель «${purposeLabels[purpose].title.toLowerCase()}» обычно подходит **${fit.name}**.`)
  }
  if (ctx.mc) {
    const limit = preApprovedLimit(ctx.mc)
    if (limit > 0) lines.push('', `По обороту счёта предварительно доступно до **${moneyShort(limit)}** — это ориентир, а не решение банка.`)
  }
  lines.push('', 'Выбор делаете вы — отметьте цель и продукт в форме, ассистент только поясняет.')
  const hints: AssistantHint[] = onScreen(ctx, 'wizard.product')
    ? [
        { target: 'purpose', label: 'Показать выбор цели' },
        { target: 'product-list', label: 'Показать продукты' },
      ]
    : onScreen(ctx, 'dashboard')
      ? [{ target: 'new-application', label: 'Показать кнопку новой заявки' }]
      : []
  return { content: lines.join('\n'), hints, suggestions: ['Сколько будет платёж?', 'Чем овердрафт отличается от оборотного кредита?'] }
}

function overdraftVsWorking(): Reply {
  return {
    content:
      '**Овердрафт** — это лимит на расчётном счёте: деньги списываются, когда на счёте не хватает средств, и гасятся автоматически из поступлений. Удобен для коротких разрывов — до 12 месяцев.\n\n**Оборотный кредит** — разовая сумма с графиком равных платежей на срок до 36 месяцев. Подходит для крупной закупки или подготовки к сезону.\n\nЕсли деньги нужны на несколько недель до поступления выручки — чаще выбирают овердрафт. Если на закупку, которая окупится за несколько месяцев, — оборотный кредит.',
    suggestions: ['Сколько будет платёж?', 'Какие риски у этого кредита?'],
  }
}

function limitReply(ctx: Ctx): Reply {
  if (!ctx.mc) return fallbackReply(ctx)
  const limit = preApprovedLimit(ctx.mc)
  const fcf = avgFreeCashFlow(ctx.mc.turnover)
  if (limit <= 0) {
    return {
      content: `Предварительный лимит сейчас не рассчитан: по данным счёта и внешних источников есть ограничения (например, задолженности или отрицательный денежный поток). Подать заявку можно, но решение примет банк после проверки.`,
      suggestions: ['Что влияет на решение?', 'Какой продукт мне подходит?'],
    }
  }
  return {
    content: `**Предварительный лимит — ${money(limit)}.** Он рассчитан по обороту вашего счёта за ${ctx.mc.turnover.length} мес.:\n\n- средний свободный денежный поток — ${money(fcf)} в месяц;\n- платёж по кредиту на 24 месяца должен занимать не больше 60% этой суммы.\n\nЭто ориентир, а не решение банка: итог зависит от проверки заявки, кредитной истории и данных ФНС.`,
    hints: onScreen(ctx, 'dashboard') ? [{ target: 'turnover-chart', label: 'Показать обороты' }] : [],
    suggestions: ['Какой продукт мне подходит?', 'Сколько будет платёж?'],
  }
}

function fieldReply(ctx: Ctx): Reply | null {
  const t = ctx.text
  if (has(t, 'выручк') && has(t, 'за 3', 'три месяц', 'последние')) {
    return {
      content: '**Выручка за последние 3 месяца** — поступления от продаж помесячно. По ним банк видит динамику: растёт бизнес или проседает. Мы предзаполнили цифры по выписке счёта.',
      hints: [{ target: 'revenue_last_3m', label: 'Показать поля' }],
      suggestions: ['Что считать выручкой?', 'Зачем банку расходы?'],
    }
  }
  if (has(t, 'выручк')) {
    return {
      content:
        '**Выручка за 12 месяцев** — все поступления от продаж товаров и услуг до вычета расходов и налогов.\n\nМы предзаполнили её по оборотам вашего счёта. Если часть поступлений — не выручка (займы, возвраты, переводы между своими счетами), уменьшите цифру: банк сверит её с данными ФНС, и сильное расхождение потребует пояснений.',
      hints: [{ target: 'revenue_12m', label: 'Показать поле выручки' }],
      suggestions: ['Что такое чистая прибыль?', 'Что указать в текущих платежах?'],
    }
  }
  if (has(t, 'расход')) {
    return {
      content: '**Расходы за 12 месяцев** — все затраты бизнеса: закупки, зарплаты, аренда, налоги, платежи по кредитам. По разнице выручки и расходов банк понимает, из каких денег вы будете платить.',
      hints: [{ target: 'expenses_12m', label: 'Показать поле расходов' }],
      suggestions: ['Что считать выручкой?', 'Что такое чистая прибыль?'],
    }
  }
  if (has(t, 'прибыл')) {
    return {
      content: '**Чистая прибыль** — выручка минус все расходы и налоги за 12 месяцев. Если бизнес убыточен, укажите отрицательное значение — честные данные ускоряют рассмотрение.',
      hints: [{ target: 'net_profit_12m', label: 'Показать поле прибыли' }],
      suggestions: ['Что указать в текущих платежах?'],
    }
  }
  if (has(t, 'текущ', 'долг', 'по кредитам', 'лизинг')) {
    const debt = ctx.mc ? companyLoans(ctx.db, ctx.mc, ctx.now).reduce((sum, loan) => sum + loan.monthly_payment, 0) : 0
    return {
      content: `**Текущие платежи по кредитам** — сумма ежемесячных платежей по всем действующим кредитам, лизингу и займам, в любых банках.${debt ? ` По известным нам кредитам это ${money(debt)} в месяц.` : ''} Банк всё равно увидит их в кредитной истории, поэтому лучше указать полностью.`,
      hints: [{ target: 'monthly_debt_payments', label: 'Показать поле' }],
      suggestions: ['Что такое долговая нагрузка?'],
    }
  }
  if (has(t, 'нагрузк')) {
    return {
      content: '**Долговая нагрузка** — доля выручки, которая уходит на платежи по всем кредитам, включая новый. Чем она ниже, тем устойчивее бизнес к спаду продаж. Комфортным считается уровень до 20–30% месячной выручки.',
      suggestions: ['Как снизить платёж?', 'Какие риски у этого кредита?'],
    }
  }
  if (has(t, 'сотрудник')) {
    return {
      content: '**Число сотрудников** — среднесписочная численность. Банк сверяет её с открытыми данными, поэтому указывайте фактическую цифру.',
      hints: [{ target: 'employees_count', label: 'Показать поле' }],
    }
  }
  if (has(t, 'усн', 'осн', 'патент', 'налогообложен')) {
    return {
      content: '**Система налогообложения** нужна, чтобы правильно прочитать отчётность: на УСН банк смотрит книгу доходов и декларацию, на ОСН — бухгалтерскую отчётность. Выберите систему, на которой бизнес работает сейчас.',
      hints: [{ target: 'tax_system', label: 'Показать поле' }],
    }
  }
  if (has(t, 'бки', 'кредитной истор', 'кредитная истор', 'бюро')) {
    return {
      content:
        '**Согласие на запрос в БКИ** разрешает банку получить кредитную историю компании и руководителя. Без него заявку рассмотреть нельзя.\n\nСам запрос фиксируется в истории. Один запрос не страшен, но много заявок в разные банки за короткий срок могут насторожить кредиторов.',
      hints: onScreen(ctx, 'wizard.review') ? [{ target: 'consent-bki', label: 'Показать согласие' }] : [],
      suggestions: ['Зачем согласие на обработку данных?', 'Какие риски у этого кредита?'],
    }
  }
  if (has(t, 'персональн', 'обработку данных', 'обработк')) {
    return {
      content: '**Согласие на обработку персональных данных** нужно, чтобы банк мог проверить руководителя и владельцев по открытым реестрам и хранить данные заявки. Данные используются только для рассмотрения и обслуживания кредита.',
      hints: onScreen(ctx, 'wizard.review') ? [{ target: 'consent-personal', label: 'Показать согласие' }] : [],
    }
  }
  if (has(t, 'счёт на', 'счет на', 'инвойс', 'документ', 'выписк', 'декларац')) {
    const requiresInvoice = ctx.context.data.requires_invoice === true || ctx.record?.app.product.requires_invoice === true
    const lines = [
      'Какие документы нужны:',
      '',
      '- **Выписка по счёту** — если основной счёт в нашем банке, загружать не нужно: обороты уже видны.',
      '- **Налоговая декларация** — подтверждает выручку; банк сверит её с данными ФНС.',
    ]
    if (requiresInvoice || has(t, 'оборудован', 'счёт на', 'счет на')) {
      lines.push('- **Счёт на оборудование** (или договор поставщика) — обязателен для кредита на оборудование: подтверждает, на что пойдут деньги, и цену покупки.')
    }
    lines.push('', 'Файлы можно перетащить в область загрузки на шаге «Документы».')
    return {
      content: lines.join('\n'),
      hints: onScreen(ctx, 'wizard.documents') ? [{ target: 'documents-upload', label: 'Показать загрузку' }] : [],
      suggestions: ['Что будет после отправки?', 'Какие риски у этого кредита?'],
    }
  }
  if (has(t, 'инн', 'егрюл', 'огрн', 'реквизит', 'данные компании')) {
    return {
      content: 'Реквизиты компании подтягиваются из **ЕГРЮЛ/ЕГРИП** по ИНН — их нельзя изменить вручную, банк ориентируется на реестр. Проверьте название, адрес и руководителя и отметьте **«Данные верны»**. Если в реестре ошибка, её нужно исправить через налоговую.',
      hints: onScreen(ctx, 'wizard.company')
        ? [
            { target: 'company-data', label: 'Показать данные компании' },
            { target: 'company-confirm', label: 'Показать подтверждение' },
          ]
        : onScreen(ctx, 'company')
          ? [{ target: 'company-profile', label: 'Показать реквизиты' }]
          : [],
    }
  }
  if (has(t, 'код', 'подпис')) {
    return {
      content: 'Договор подписывается **простой электронной подписью**: код подтверждения равен вашей подписи на бумаге. Перед подписанием прочитайте договор, особенно разделы о платежах и ответственности за просрочку. В демо-режиме код показан на экране.',
      hints: onScreen(ctx, 'sign')
        ? [
            { target: 'contract', label: 'Показать договор' },
            { target: 'sign-code', label: 'Показать поле кода' },
          ]
        : [],
      suggestions: ['Что будет при просрочке?', 'Когда придут деньги?'],
    }
  }
  if (has(t, 'график')) {
    return {
      content: '**График платежей** показывает дату и сумму каждого платежа, а также сколько из платежа идёт на проценты и на основной долг. Платёж списывается с расчётного счёта — держите сумму на счёте заранее.',
      hints: onScreen(ctx, 'application') ? [{ target: 'schedule', label: 'Показать график' }] : [],
    }
  }
  if (has(t, 'когда придут', 'когда деньги', 'зачисл')) {
    return {
      content: 'После подписания договора деньги поступают на расчётный счёт автоматически — обычно в течение нескольких минут. Статус заявки сменится на **«Средства зачислены»**, придёт уведомление.',
      suggestions: ['Сколько будет платёж?'],
    }
  }
  if (has(t, 'сколько ждать', 'как долго', 'сколько времени')) {
    return {
      content: 'Автоматическая проверка занимает меньше минуты. Если заявку передали специалисту — обычно до 1 рабочего дня. Статус обновляется сам, уведомление придёт в кабинет.',
      suggestions: ['Что означает мой статус?', 'Что влияет на решение?'],
    }
  }
  if (has(t, 'что влияет')) return decisionReply({ ...ctx, record: undefined })
  if (has(t, 'после отправки', 'что дальше', 'что делать дальше')) return statusReply(ctx)
  return null
}

const SCREEN_HELP: Record<string, { text: (ctx: Ctx) => string; hints: AssistantHint[]; suggestions: string[] }> = {
  dashboard: {
    text: (ctx) => {
      const name = str(ctx.context, 'company_name') ?? ctx.mc?.company.name ?? 'вашей компании'
      return `Это главная кабинета **${name}**: предварительный лимит, обороты счёта, действующие кредиты и заявки. Чтобы получить финансирование, нажмите **«Нужно финансирование»** — дальше форма проведёт по шагам.`
    },
    hints: [{ target: 'new-application', label: 'Показать кнопку новой заявки' }],
    suggestions: ['Какой продукт мне подходит?', 'Как рассчитан предварительный лимит?', 'Что означает мой статус?'],
  },
  'wizard.product': {
    text: () => '**Шаг 1 из 6 — продукт.** Выберите цель финансирования: от неё зависят продукт, максимальный срок и список документов. Подходящий продукт отмечен, но выбрать можно любой.',
    hints: [{ target: 'purpose', label: 'Показать выбор цели' }],
    suggestions: ['Какой продукт мне подходит?', 'Чем овердрафт отличается от оборотного кредита?'],
  },
  'wizard.amount': {
    text: (ctx) => {
      const amount = num(ctx.context, 'amount')
      const term = num(ctx.context, 'term')
      return `**Шаг 2 из 6 — сумма и срок.**${amount && term ? ` Сейчас ${money(amount)} на ${term} мес.` : ''} Рядом — расчёт платежа, ниже — впишется ли платёж в ваш денежный поток и предупреждение о рисках. Прочитайте его до перехода дальше.`
    },
    hints: [
      { target: 'payment-summary', label: 'Показать расчёт' },
      { target: 'cashflow-fit', label: 'Впишется ли платёж' },
    ],
    suggestions: ['Сколько будет платёж?', 'Какие риски у этого кредита?', 'Как снизить платёж?'],
  },
  'wizard.company': {
    text: () => '**Шаг 3 из 6 — компания.** Проверьте реквизиты по данным ЕГРЮЛ и отметьте «Данные верны». Вводить их вручную не нужно.',
    hints: [{ target: 'company-confirm', label: 'Показать подтверждение' }],
    suggestions: ['Откуда эти данные?', 'Что делать, если данные неверны?'],
  },
  'wizard.financials': {
    text: () => '**Шаг 4 из 6 — финансы.** Мы предзаполнили показатели по выписке вашего счёта. Проверьте их и поправьте, если часть поступлений — не выручка.',
    hints: [{ target: 'revenue_12m', label: 'Показать выручку' }],
    suggestions: ['Что считать выручкой?', 'Что указать в текущих платежах?', 'Что такое чистая прибыль?'],
  },
  'wizard.documents': {
    text: (ctx) =>
      `**Шаг 5 из 6 — документы.** Перетащите файлы в область загрузки.${ctx.context.data.requires_invoice === true ? ' Для кредита на оборудование обязателен **счёт на оборудование**.' : ''}`,
    hints: [{ target: 'documents-upload', label: 'Показать загрузку' }],
    suggestions: ['Какие документы нужны?', 'Зачем счёт на оборудование?'],
  },
  'wizard.review': {
    text: (ctx) => {
      const missing = str(ctx.context, 'missing_consents')
      return `**Последний шаг — проверка и отправка.** Проверьте сводку и дайте согласия.${missing ? ` Ещё не отмечено: ${missing}.` : ''} После отправки данные изменить нельзя, но банк может запросить уточнения.`
    },
    hints: [
      { target: 'summary', label: 'Показать сводку' },
      { target: 'submit', label: 'Показать кнопку отправки' },
    ],
    suggestions: ['Зачем согласие на БКИ?', 'Что будет после отправки?', 'Какие риски у этого кредита?'],
  },
  sign: {
    text: () => '**Подписание договора.** Прочитайте условия, отметьте «С условиями ознакомлен» и подтвердите подписание кодом. После подписания деньги поступят на счёт автоматически.',
    hints: [
      { target: 'contract', label: 'Показать договор' },
      { target: 'sign-confirm', label: 'Показать подтверждение' },
    ],
    suggestions: ['Что будет при просрочке?', 'Когда придут деньги?'],
  },
  applications: {
    text: (ctx) => {
      const total = num(ctx.context, 'total')
      const action = num(ctx.context, 'action_required')
      const processing = num(ctx.context, 'processing')
      const drafts = num(ctx.context, 'drafts')
      const parts: string[] = []
      if (total !== null) parts.push(`всего ${total}`)
      if (action) parts.push(`требуют вашего действия: ${action}`)
      if (processing) parts.push(`в обработке: ${processing}`)
      if (drafts) parts.push(`черновики: ${drafts}`)
      return `Это список ваших заявок${parts.length ? ` — ${parts.join(', ')}` : ''}. Откройте заявку, чтобы увидеть этапы и что нужно сделать. Черновики открываются в форме для продолжения.`
    },
    hints: [],
    suggestions: ['Что означает мой статус?', 'Сколько ждать решения?'],
  },
  onboarding: {
    text: () =>
      'Чтобы подать заявку, к кабинету нужно привязать **ИП или юрлицо**. Введите ИНН — мы найдём компанию в ЕГРЮЛ/ЕГРИП и подставим реквизиты, вводить их вручную не придётся.\n\n- ИНН юрлица — 10 цифр, ИП — 12 цифр.\n- Если бизнес ещё не зарегистрирован, кредит для бизнеса оформить нельзя: сначала нужна регистрация ИП или ООО в ФНС.',
    hints: [{ target: 'company-inn', label: 'Показать поле ИНН' }],
    suggestions: ['Где найти ИНН?', 'Что делать, если у меня нет ИП?', 'Чем ИП отличается от ООО для кредита?'],
  },
  notifications: {
    text: (ctx) => {
      const total = num(ctx.context, 'total')
      const unread = num(ctx.context, 'unread')
      return `Здесь все уведомления о заявках${total !== null ? `: ${total}, из них непрочитанных — ${unread ?? 0}` : ''}. Нажмите на уведомление, чтобы открыть заявку. Всё взаимодействие с банком — только в кабинете, без почты и SMS.`
    },
    hints: [{ target: 'notifications-list', label: 'Показать уведомления' }],
    suggestions: ['Что означает мой статус?'],
  },
  company: {
    text: (ctx) => {
      const loans = num(ctx.context, 'loans_count')
      const debt = num(ctx.context, 'total_debt')
      return `**Профиль компании**: реквизиты из ЕГРЮЛ и действующие кредиты${loans ? ` (${loans}, остаток долга ${money(debt ?? 0)})` : ''}. Эти данные автоматически подставляются в заявку.`
    },
    hints: [
      { target: 'company-profile', label: 'Показать реквизиты' },
      { target: 'company-loans', label: 'Показать кредиты' },
    ],
    suggestions: ['Откуда эти данные?', 'Как рассчитан предварительный лимит?'],
  },
}

function fallbackReply(ctx: Ctx): Reply {
  if (onScreen(ctx, 'application') && ctx.record) return statusReply(ctx)
  const help = SCREEN_HELP[ctx.context.screen]
  if (help) return { content: help.text(ctx), hints: help.hints, suggestions: help.suggestions }
  return {
    content: `Я подсказываю по текущему экрану${ctx.context.title ? ` «${ctx.context.title}»` : ''}: объясняю термины, расчёты и следующие шаги. Все действия — в основной части экрана, решения принимаете вы.`,
    suggestions: ['Какой продукт мне подходит?', 'Что означает мой статус?', 'Сколько будет платёж?'],
  }
}

function greetingReply(ctx: Ctx): Reply {
  const base = fallbackReply(ctx)
  return {
    ...base,
    content: `Здравствуйте, ${firstName(ctx.user)}! Я поясняю то, что на экране: термины, расчёты, статусы и следующие шаги. Оформление и решения — за вами, в основной части экрана.\n\n${base.content}`,
  }
}

function route(ctx: Ctx): Reply {
  const t = ctx.text
  if (/^(привет|здравств|добрый день|добрый вечер|доброе утро|hello|hi)/.test(t) && t.length < 40) return greetingReply(ctx)
  if (has(t, 'лимит', 'предварительн')) return limitReply(ctx)
  if (has(t, 'отличается', 'разница между') && has(t, 'овердрафт', 'оборотн')) return overdraftVsWorking()
  if (has(t, 'снизить плат', 'уменьшить плат', 'меньше плат', 'снизить нагрузк', 'как снизить')) return lowerPaymentReply(ctx)
  if (has(t, 'риск', 'опасн', 'чем грозит', 'стоит ли', 'просрочк', 'упад', 'не смогу', 'не хватит', 'впишется')) return riskReply(ctx)
  if (has(t, 'платёж', 'платеж', 'сколько платить', 'переплат', 'в месяц', 'проценты')) return paymentReply(ctx)
  if (has(t, 'статус', 'что происходит', 'что с заявк', 'где моя', 'заявк')) {
    if (!has(t, 'почему', 'отказ', 'решени')) return statusReply(ctx)
  }
  if (has(t, 'почему', 'отказ', 'решени', 'условия', 'предложени')) return decisionReply(ctx)
  if (has(t, 'какой продукт', 'подходит', 'подобрать', 'овердрафт', 'оборотн', 'оборудован', 'продукт')) {
    const field = has(t, 'счёт на', 'счет на', 'зачем счёт', 'зачем счет') ? fieldReply(ctx) : null
    return field ?? productReply(ctx)
  }
  return fieldReply(ctx) ?? fallbackReply(ctx)
}

export function assistantReply(db: MockDb, user: MockUser, request: AssistantChatRequest, now: number): AssistantMessage {
  const mc = findCompany(db, user.company_id)
  const candidate = request.context.application_id ? findApplication(db, request.context.application_id) : undefined
  const record = candidate && candidate.company_id === user.company_id ? candidate : undefined
  const reply = route({ db, user, mc, context: request.context, record, text: normalize(request.message), now })
  return {
    id: uid(),
    role: 'assistant',
    content: reply.content,
    hints: reply.hints ?? [],
    suggestions: (reply.suggestions ?? []).slice(0, 3),
    created_at: iso(now),
  }
}

export function userMessage(text: string, now: number): AssistantMessage {
  return { id: uid(), role: 'user', content: text, hints: [], suggestions: [], created_at: iso(now) }
}
