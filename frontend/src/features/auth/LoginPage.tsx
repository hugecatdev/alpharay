import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ApiError } from '@/api'
import { homeFor } from '@/app/guards'
import { Alert, Button, Field, Input, Logo } from '@/shared/ui'
import { useAuth } from './AuthProvider'
import styles from './LoginPage.module.css'

const schema = z.object({
  email: z.string().trim().min(1, 'Введите email').email('Проверьте формат email'),
  password: z.string().min(1, 'Введите пароль'),
})

type LoginForm = z.infer<typeof schema>

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  const from = (location.state as { from?: string } | null)?.from

  async function onSubmit(values: LoginForm) {
    setError(null)
    try {
      const user = await login(values.email.trim(), values.password)
      const home = homeFor(user.role)
      navigate(from && from.startsWith(home) ? from : home, { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? 'Неверный email или пароль' : 'Не удалось войти. Попробуйте ещё раз.')
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.column}>
        <Logo size="md" />
        <form className={styles.card} onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className={styles.head}>
            <h1>Вход в кабинет</h1>
            <p>Кредиты для бизнеса — от заявки до зачисления</p>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Email" error={errors.email?.message}>
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="username"
                autoFocus
                placeholder="name@company.ru"
                invalid={!!errors.email}
                {...register('email')}
              />
            )}
          </Field>
          <Field label="Пароль" error={errors.password?.message}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                invalid={!!errors.password}
                {...register('password')}
              />
            )}
          </Field>
          <Button type="submit" size="lg" block loading={isSubmitting} iconRight={<ArrowRight size={18} />}>
            Войти
          </Button>
        </form>
        <p className={styles.footer}>© {new Date().getFullYear()} AlphaRay</p>
      </main>
    </div>
  )
}
