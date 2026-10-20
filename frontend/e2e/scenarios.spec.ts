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
  await page.getByRole('link', { name: /Перейти к подписанию/ }).first().click()
  await expect(page).toHaveURL(/\/sign$/)
  await expect(page.locator('iframe[title="Текст кредитного договора"]')).toBeVisible()
  await page.getByText('С условиями договора ознакомлен(а)').click()
  await expect(page.getByLabel('С условиями договора ознакомлен(а)')).toBeChecked()
  await page.getByRole('button', { name: 'Подписать', exact: true }).click()
  await page.getByLabel('Код подтверждения').fill('1111')
  await page.getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Неверный код').first()).toBeVisible()
  await page.getByLabel('Код подтверждения').fill('4821')
  await page.getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Средства зачислены').first()).toBeVisible({ timeout: 20_000 })
  await shot(page, '13-disbursed')
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
  await waitForStatus(page, 'Одобрено')
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
  await block.locator('input[inputmode="numeric"], input[type="text"]').first().fill('41000000')
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

test('ассистент объясняет экран и подсвечивает элемент', async ({ page }) => {
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

test('client6 без компании: онбординг по ИНН → заявка', async ({ page }) => {
  await login(page, 'client6@demo.local')
  await expect(page.getByText('Добавьте компанию')).toBeVisible()
  await shot(page, '70-onboarding')
  await page.getByLabel('ИНН компании или ИП').fill('0000000000')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await expect(page.getByText(/Не нашли компанию/)).toBeVisible()
  await page.getByLabel('ИНН компании или ИП').fill('771405283916')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ИП Петров П.С.' })).toBeVisible()
  await shot(page, '71-onboarding-found')
  await page.getByRole('button', { name: 'Это моя компания' }).click()
  await expect(page.locator('[data-assist="company-card"]')).toBeVisible()
  await shot(page, '72-dashboard-newcomer')
  await page.goto('/app/applications/new')
  await page.getByRole('button', { name: /^Пополнение оборотных средств/ }).click()
  await page.locator('[data-assist="product-WORKING_CAPITAL"]').click()
  await page.getByRole('button', { name: 'Перейти к сумме и сроку' }).click()
  await expect(page).toHaveURL(/step=amount/)
  await shot(page, '73-newcomer-amount')
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await page.getByText('Данные компании верны').click()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page).toHaveURL(/step=financials/)
  await shot(page, '74-newcomer-financials')
})
