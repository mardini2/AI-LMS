// shared chrome with role-aware nav and logout

import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { authStorage } from '../features/auth/auth-storage'
import { Button, Card } from '../components/ui'

interface NavItem {
  label: string
  to: string
  matchPrefix: string
}

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const session = authStorage.get()
  const role = session?.user.role

  const navItems: NavItem[] =
    role === 'ADMIN'
      ? [
          { label: 'Dashboard', to: '/dashboard', matchPrefix: '/dashboard' },
          { label: 'Courses', to: '/courses', matchPrefix: '/courses' },
          { label: 'Users', to: '/admin/users', matchPrefix: '/admin/users' },
        ]
      : role === 'STUDENT'
        ? [
            { label: 'Dashboard', to: '/dashboard', matchPrefix: '/dashboard' },
            { label: 'My Learning', to: '/my-learning', matchPrefix: '/my-learning' },
          ]
        : [
            { label: 'Dashboard', to: '/dashboard', matchPrefix: '/dashboard' },
            { label: 'Courses', to: '/courses', matchPrefix: '/courses' },
          ]

  const activeNavIndex = Math.max(
    0,
    navItems.findIndex((item) => location.pathname.startsWith(item.matchPrefix)),
  )

  return (
    <div className="min-h-screen bg-slate-50/80">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <img
              src="/logo.svg"
              alt="Syllentra logo"
              className="h-9 w-9 rounded-lg object-contain"
            />
            <div>
              <p className="text-sm font-semibold text-slate-900">Syllentra</p>
              <p className="text-xs text-slate-500">AI-assisted learning platform</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <nav
              className="relative hidden rounded-xl border border-slate-200 bg-slate-50 p-1 md:grid"
              style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
            >
              <div
                className="absolute bottom-1 top-1 rounded-lg bg-white shadow-sm transition-transform duration-300 ease-out"
                style={{
                  width: `calc((100% - 0.5rem) / ${navItems.length})`,
                  transform: `translateX(calc(${activeNavIndex} * 100%))`,
                }}
              />
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `relative z-10 rounded-lg px-3 py-1.5 text-center text-sm font-medium transition ${
                      isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <Card className="hidden min-w-[210px] items-center gap-2 p-2 md:flex">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-800">{session?.user.fullName}</p>
                <p className="text-xs text-slate-500">{session?.user.role}</p>
              </div>
              <Button
                variant="ghost"
                className="px-2.5 py-1.5 text-xs"
                onClick={() => {
                  authStorage.clear()
                  navigate('/login')
                }}
              >
                Logout
              </Button>
            </Card>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
