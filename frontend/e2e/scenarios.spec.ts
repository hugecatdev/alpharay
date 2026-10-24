import { expect, test, type Page } from '@playwright/test'
import { login, logout, resetDemo, shot } from './helpers'

interface WizardInput {
  purpose: string
  product: string
  amount?: number
  amountShot?: string
}

async function fillWizard(page: Page, input: WizardInput) {
  await page.goto('/app/applications/new')
  await page.getByRole('button', { name: new RegExp(`^${input.purpose}`) }).click()
  await page.locator(`[data-assist="product-${input.product}"]`).click()
  await page.getByRole('button', { name: 'Перейти к сумме и сроку' }).click()
  await expect(page).toHaveURL(/step=amount/)
  if (input.amount) {
    const amount = page.locator('[data-assist="amount"] input[inputmode="numeric"]')
    await amount.fill(String(input.amount))
    await amount.press('Enter')
  }
  await expect(page.locator('[data-assist="risk-warning"]')).toBeVisible()
  if (input.amountShot) await shot(page, input.amountShot)
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page).toHaveURL(/step=company/)
  await page.getByText('Данные компании верны').click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page).toHaveURL(/step=financials/)
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page).toHaveURL(/step=documents/)
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page).toHaveURL(/step=review/)
  await page.getByText('Согласие на запрос в бюро кредитных историй').click()
  await page.getByText('Согласие на обработку персональных данных').click()
  await page.getByText('Я понимаю, что кредит нужно возвращать').click()
  await page.getByRole('button', { name: 'Отправить заявку' }).click()
  await expect(page).toHaveURL(/\/app\/applications\/[^/]+$/)
}

async function waitForStatus(page: Page, title: string) {
  await expect(page.locator('[data-assist="status"]').getByText(title, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await resetDemo(page)
})

test('client1: заявка → одобрение → подписание → выдача', async ({ page }) => {
  await login(page, 'client1@demo.local')
  await fillWizard(page, {
    purpose: 'Пополнение оборотных средств',
    product: 'WORKING_CAPITAL',
    amount: 2_000_000,
    amountShot: '10-wizard-amount',
  })
  await shot(page, '11-application-processing')
  await waitForStatus(page, 'Одобрено')
  await shot(page, '12-application-approved')
  await page.getByRole('button', { name: 'Принять условия' }).click()
  await waitForStatus(page, 'Условия приняты')
  await page.getByRole('link', { name: /Перейти к подписанию/ }).first().click()
  await expect(page).toHaveURL(/\/sign$/)
  await expect(page.getByText(/Подписание и выдача смоделированы/)).toBeVisible()
  await expect(page.locator('iframe[title="Текст кредитного договора"]')).toBeVisible()
  await page.getByLabel('С условиями договора ознакомлен(а)').check()
  await page.getByRole('button', { name: 'Подписать', exact: true }).click()
  const certificates = page.locator('[data-assist="sign-certificate"]')
  await expect(certificates.getByText('Срок действия сертификата истёк')).toBeVisible()
  await certificates.getByRole('button', { name: /Действителен/ }).click()
  await page.getByRole('button', { name: 'Подписать КЭП' }).click()
  await expect(page.getByText('Средства зачислены').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Выдача смоделирована: операция PAY-/)).toBeVisible()
  await shot(page, '13-disbursed')
})

test('client1: подписание кодом с экрана, без SMS', async ({ page }) => {
  await login(page, 'client1@demo.local')
  await fillWizard(page, { purpose: 'Пополнение оборотных средств', product: 'WORKING_CAPITAL', amount: 1_000_000 })
  await waitForStatus(page, 'Одобрено')
  await page.getByRole('button', { name: 'Принять условия' }).click()
  await waitForStatus(page, 'Условия приняты')
  await page.getByRole('link', { name: /Перейти к подписанию/ }).first().click()
  await page.getByLabel('С условиями договора ознакомлен(а)').check()
  await page.getByRole('button', { name: 'Подписать', exact: true }).click()
  await page.getByRole('button', { name: /Подписать кодом подтверждения/ }).click()
  const code = page.locator('[data-assist="sign-code"]')
  await expect(code.getByText('4821')).toBeVisible()
  await code.getByLabel('Код подтверждения').fill('4821')
  await code.getByRole('button', { name: 'Подписать кодом' }).click()
  await expect(page.getByText('Средства зачислены').first()).toBeVisible({ timeout: 20_000 })
})

test('client3 → андеррайтер: контрпредложение → клиент принимает', async ({ page }) => {
  await login(page, 'underwriter@bank.local')
  await shot(page, '20-bank-queue')
  await page.getByRole('row', { name: /СтройМастер/ }).first().click()
  await expect(page).toHaveURL(/\/bank\/applications\//)
  const take = page.getByRole('button', { name: 'Взять в работу' })
  if (await take.isVisible()) await take.click()
  await shot(page, '21-bank-application')
  await page.getByRole('button', { name: /На других условиях/ }).click()
  await page.getByLabel('Комментарий для клиента').fill('Предлагаем меньшую сумму с учётом текущей нагрузки')
  await page.getByRole('button', { name: 'Отправить предложение' }).click()
  await expect(page.getByText('Решение отправлено клиенту')).toBeVisible()
  await logout(page)
  await login(page, 'client3@demo.local')
  await page.goto('/app/applications')
  await page.getByText(/Предложение на других условиях/).first().click()
  await expect(page.locator('[data-assist="counter-offer"]')).toBeVisible()
  await shot(page, '22-counter-offer')
  await page.getByRole('button', { name: 'Принять предложение' }).click()
  await waitForStatus(page, 'Условия приняты')
})

test('администратор банка входит в кабинет банка и видит очередь', async ({ page }) => {
  await login(page, 'admin@bank.local')
  await expect(page.getByRole('row', { name: /СтройМастер/ }).first()).toBeVisible()
  await page.goto('/app')
  await expect(page).toHaveURL(/\/bank/)
})

test('client4: отказ с причинами', async ({ page }) => {
  await login(page, 'client4@demo.local')
  await fillWizard(page, { purpose: 'Пополнение оборотных средств', product: 'WORKING_CAPITAL', amount: 1_000_000 })
  await waitForStatus(page, 'Отказ')
  await expect(page.getByText('Налоговая задолженность 312 000 ₽').first()).toBeVisible()
  await shot(page, '30-rejected')
})

test('client5: нужна информация → дополнить → повторный прогон', async ({ page }) => {
  await login(page, 'client5@demo.local')
  await fillWizard(page, { purpose: 'Пополнение оборотных средств', product: 'WORKING_CAPITAL', amount: 1_500_000 })
  await waitForStatus(page, 'Нужна информация')
  await shot(page, '40-need-info')
  const block = page.locator('[data-assist="info-request"]')
  await block.locator('input[inputmode="numeric"], input[type="text"]').first().fill('24000000')
  await block.locator('input[type="file"]').first().setInputFiles({
    name: 'vypiska-6m.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 demo'),
  })
  await page.getByRole('button', { name: 'Отправить банку' }).click()
  await waitForStatus(page, 'Одобрено')
})

test('оборудование без счёта блокирует шаг документов', async ({ page }) => {
  await login(page, 'client2@demo.local')
  await page.goto('/app/applications/new')
  await page.getByRole('button', { name: /^Покупка оборудования/ }).click()
  await page.locator('[data-assist="product-EQUIPMENT"]').click()
  await page.getByRole('button', { name: 'Перейти к сумме и сроку' }).click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByText('Данные компании верны').click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page).toHaveURL(/step=documents/)
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page).toHaveURL(/step=documents/)
  await shot(page, '50-documents-invoice-required')
})

async function assistantEnabled(page: Page): Promise<boolean> {
  const response = await page.request.get('/api/config')
  const config = (await response.json()) as { assistant_enabled: boolean }
  return config.assistant_enabled
}

test('без ключа LLM Рэй скрыт, сценарий работает формами', async ({ page }) => {
  test.skip(await assistantEnabled(page), 'на бэкенде задан ключ LLM')
  await login(page, 'client1@demo.local')
  await page.goto('/app/applications/new')
  await page.getByRole('button', { name: /^Покрытие кассовых разрывов/ }).click()
  await page.locator('[data-assist="product-OVERDRAFT"]').click()
  await page.getByRole('button', { name: 'Перейти к сумме и сроку' }).click()
  await expect(page.locator('[data-assist="risk-warning"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Спросить Рэя о рисках' })).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Рэй — умный ассистент' })).toHaveCount(0)
})

test('ассистент объясняет экран и подсвечивает элемент', async ({ page }) => {
  test.skip(!(await assistantEnabled(page)), 'ключ LLM не задан — Рэй скрыт')
  await login(page, 'client1@demo.local')
  await page.goto('/app/applications/new')
  await page.getByRole('button', { name: /^Покрытие кассовых разрывов/ }).click()
  await page.locator('[data-assist="product-OVERDRAFT"]').click()
  await page.getByRole('button', { name: 'Перейти к сумме и сроку' }).click()
  await page.getByRole('button', { name: 'Спросить Рэя о рисках' }).click()
  const panel = page.getByRole('complementary', { name: 'Рэй — умный ассистент' })
  await expect(panel.getByText('Рэй печатает')).toBeVisible()
  await expect(panel.getByText('Рэй печатает')).toBeHidden({ timeout: 10_000 })
  const hint = panel.locator('button', { has: page.locator('svg') }).filter({ hasText: /Показать|Посмотреть|Где/ }).first()
  if (await hint.count()) {
    await hint.click()
    await expect(page.locator('[data-assist-highlight="on"]')).toHaveCount(1)
  }
  await shot(page, '60-assistant-risks')
  await panel.getByLabel('Сообщение Рэю').fill('Сколько будет платёж?')
  await panel.getByLabel('Сообщение Рэю').press('Enter')
  await expect(panel.getByText('Рэй печатает')).toBeHidden({ timeout: 10_000 })
  await shot(page, '61-assistant-payment')
})

test('ассистент по просьбе подставляет сумму и срок в форму', async ({ page }) => {
  test.skip(!(await assistantEnabled(page)), 'ключ LLM не задан — Рэй скрыт')
  await login(page, 'client1@demo.local')
  await page.goto('/app/applications/new')
  await page.getByRole('button', { name: /^Пополнение оборотных средств/ }).click()
  await page.locator('[data-assist="product-WORKING_CAPITAL"]').click()
  await page.getByRole('button', { name: 'Перейти к сумме и сроку' }).click()
  await expect(page).toHaveURL(/step=amount/)
  const panel = page.getByRole('complementary', { name: 'Рэй — умный ассистент' })
  await panel.getByLabel('Сообщение Рэю').fill('Поставь сумму 2 000 000 рублей и срок 36 месяцев')
  await panel.getByLabel('Сообщение Рэю').press('Enter')
  await expect(panel.getByText('Рэй печатает')).toBeHidden({ timeout: 25_000 })
  await expect(panel.getByText(/Подставлено в форму: 2.000.000.₽ · 36 мес\./)).toBeVisible()
  await expect(page.locator('[data-assist="amount"] input[inputmode="numeric"]')).toHaveValue(/^2\D?000\D?000$/)
  await expect(page.locator('[data-assist="term"] input[inputmode="numeric"]')).toHaveValue('36')
  await expect(panel.getByText(/WORKING_CAPITAL|EQUIPMENT|OVERDRAFT/)).toHaveCount(0)
  await shot(page, '62-assistant-fill')
})
