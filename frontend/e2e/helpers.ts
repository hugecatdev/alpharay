import { expect, type Page } from '@playwright/test'

export async function resetDemo(page: Page) {
  const response = await page.request.post('/api/demo/reset')
  expect(response.status()).toBe(204)
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/login')
}

export async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль').fill('demo')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(email.endsWith('@bank.local') ? /\/bank/ : /\/app/)
}

export async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('alpharay-token')
    sessionStorage.clear()
  })
}

export async function shot(page: Page, name: string) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `e2e-screens/${name}.png`, fullPage: true })
}
