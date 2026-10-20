import { expect, type Page } from '@playwright/test'

export async function resetDemo(page: Page) {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/login')
}

export async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('demo')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(email.startsWith('underwriter') ? /\/bank/ : /\/app/)
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
