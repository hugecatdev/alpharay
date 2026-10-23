import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 5180)
const apiPort = Number(process.env.E2E_API_PORT ?? 8010)
const python = process.env.BACKEND_PYTHON ?? '.venv/bin/python'
const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgresql+psycopg://postgres:test@127.0.0.1:55432/alpharay_e2e'

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: {
        DATABASE_URL: databaseUrl,
        UPLOAD_DIR: '',
        DEMO_RESET_ENABLED: 'true',
        PIPELINE_WORKER: 'true',
        RATE_LIMIT_ENABLED: 'false',
        LOG_FORMAT: 'text',
      },
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${port} --strictPort`,
      url: `http://localhost:${port}`,
      env: { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` },
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
