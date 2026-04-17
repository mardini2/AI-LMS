// goal: email/password form that stores the JWT bundle and routes to the dashboard.

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { apiClient } from '../api/client'
import { authStorage } from '../features/auth/auth-storage'
import { Badge, Button, Card, Input } from '../components/ui'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

type LoginValues = z.infer<typeof loginSchema>

// same accounts as prisma/seed.ts for local setup
const seededLoginPresets = [
  { label: 'Admin', email: 'admin@syllentra.local', password: 'Admin123!' },
  { label: 'Instructor', email: 'instructor@syllentra.local', password: 'Instructor123!' },
  { label: 'Reviewer', email: 'reviewer@syllentra.local', password: 'Reviewer123!' },
  { label: 'Student', email: 'student@syllentra.local', password: 'Student123!' },
]

export function LoginPage() {
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  })

  const loginMutation = useMutation({
    mutationFn: apiClient.login,
    onSuccess: (data) => {
      authStorage.set(data)
      navigate('/dashboard')
    },
  })

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-20 h-80 w-80 rounded-full bg-cyan-300/35 blur-3xl" />
        <div className="absolute right-[-120px] top-24 h-96 w-96 rounded-full bg-sky-400/30 blur-3xl" />
        <div className="absolute bottom-[-120px] left-1/3 h-96 w-96 rounded-full bg-blue-500/25 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-sky-100/35 to-blue-100/20 backdrop-blur-[1px]" />
      </div>

      <Card className="relative w-full max-w-[460px] border-white/60 bg-white/90 shadow-xl shadow-sky-200/40 backdrop-blur">
        <div className="space-y-5">
          <div className="flex flex-col items-center text-center">
            <img
              src="/logo.png"
              alt="Syllentra"
              className="mb-3 h-14 w-auto object-contain"
            />
            <Badge variant="info">Secure Access</Badge>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Welcome to Syllentra</h1>
            <p className="text-sm text-slate-500">
              Sign in to continue your AI-assisted content quality workflow.
            </p>
          </div>

          <form className="space-y-3" onSubmit={handleSubmit((values) => loginMutation.mutate(values))}>
            <div>
              <Input placeholder="Email" type="email" {...register('email')} />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>
            <div>
              <Input placeholder="Password" type="password" {...register('password')} />
              {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
            </div>
            {loginMutation.isError && <p className="text-xs text-red-600">Login failed. Check credentials.</p>}
            <Button disabled={loginMutation.isPending} type="submit">
              {loginMutation.isPending ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Demo accounts</p>
            <div className="mt-2 space-y-1">
              {seededLoginPresets.map((account) => (
                <p key={account.email}>
                  {account.label}: {account.email} / {account.password}
                </p>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
