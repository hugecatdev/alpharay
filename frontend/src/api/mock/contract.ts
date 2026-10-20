import { buildSchedule, loanSummary } from '@/shared/lib/annuity'
import type { MockApplication } from './db'
import { dateRu, escapeHtml, money, rateText } from './utils'

export function contractHtml(record: MockApplication, now: number): string {
  const app = record.app
  const offer = app.offer
  const amount = offer?.amount ?? app.amount
  const term = offer?.term ?? app.term
  const rate = offer?.rate ?? app.product.base_rate
  const summary = loanSummary(amount, term, rate)
  const start = record.disbursed_at ? new Date(record.disbursed_at) : new Date(now)
  const schedule = buildSchedule(amount, term, rate, start)
  const company = app.company
  const number = app.contract?.number ?? `ДК-${app.number.replace('КР-', '')}`
  const firstRows = schedule
    .slice(0, 3)
    .map(
      (row, index) =>
        `<tr><td>${index + 1}</td><td>${dateRu(row.date)}</td><td>${money(row.amount)}</td><td>${money(row.principal)}</td><td>${money(row.interest)}</td><td>${money(row.balance)}</td></tr>`,
    )
    .join('')
  const signed = app.contract?.signed_at
    ? `<p class="signed">Подписан простой электронной подписью ${dateRu(app.contract.signed_at)}.</p>`
    : ''

  return `<article class="contract">
<h2>Кредитный договор № ${escapeHtml(number)}</h2>
<p class="meta">г. Москва · ${dateRu(app.contract?.signed_at ?? now)}</p>
<h3>1. Стороны</h3>
<p><strong>Кредитор:</strong> Банк (демонстрационный стенд AlphaRay).</p>
<p><strong>Заёмщик:</strong> ${escapeHtml(company.name)}, ИНН ${escapeHtml(company.inn)}, ОГРН ${escapeHtml(company.ogrn)}, адрес: ${escapeHtml(company.address)}, в лице ${escapeHtml(company.head_name)}.</p>
<h3>2. Предмет договора</h3>
<p>Кредитор предоставляет Заёмщику кредит «${escapeHtml(app.product.name)}» на следующих условиях:</p>
<table>
<tbody>
<tr><th>Сумма кредита</th><td>${money(amount)}</td></tr>
<tr><th>Срок</th><td>${term} мес.</td></tr>
<tr><th>Процентная ставка</th><td>${rateText(rate)} годовых</td></tr>
<tr><th>Ежемесячный платёж</th><td>${money(summary.monthly_payment)}</td></tr>
<tr><th>Сумма процентов за срок</th><td>${money(summary.overpayment)}</td></tr>
<tr><th>Всего к возврату</th><td>${money(summary.total_payment)}</td></tr>
<tr><th>Цель</th><td>${escapeHtml(app.purpose || 'Не указана')}</td></tr>
</tbody>
</table>
<h3>3. Порядок погашения</h3>
<p>Погашение — ежемесячными аннуитетными платежами со списанием с расчётного счёта Заёмщика. Первые платежи графика:</p>
<table>
<thead><tr><th>№</th><th>Дата</th><th>Платёж</th><th>Основной долг</th><th>Проценты</th><th>Остаток</th></tr></thead>
<tbody>${firstRows}</tbody>
</table>
<p>Полный график платежей доступен в карточке заявки в кредитном кабинете. Досрочное погашение — без комиссий, с уведомлением за 1 рабочий день.</p>
<h3>4. Ответственность</h3>
<p>За просрочку платежа начисляется неустойка 0,1% от суммы просроченной задолженности за каждый день просрочки. Сведения об исполнении обязательств передаются в бюро кредитных историй. При просрочке более 60 дней Кредитор вправе потребовать досрочного возврата кредита.</p>
<h3>5. Подписание</h3>
<p>Договор подписывается простой электронной подписью — вводом одноразового кода подтверждения в кредитном кабинете. Код приравнивается к собственноручной подписи уполномоченного лица Заёмщика.</p>
${signed}
<p class="note">Документ сформирован в демонстрационном режиме и не является офертой.</p>
</article>`
}
