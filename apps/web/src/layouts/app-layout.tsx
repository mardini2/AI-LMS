// goal: shared chrome with role-aware nav, notifications popover, and logout.

import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { authStorage } from '../features/auth/auth-storage'
import { Button, Card, Modal } from '../components/ui'
import { apiClient } from '../api/client'

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
  const queryClient = useQueryClient()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [showMoreNotifications, setShowMoreNotifications] = useState(false)

  // students get a tighter IA; staff see course management links
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

  // drives the sliding highlight under the segmented control
  const activeNavIndex = Math.max(
    0,
    navItems.findIndex((item) => location.pathname.startsWith(item.matchPrefix)),
  )

  const notificationsQuery = useQuery({
    queryKey: ['notifications', showMoreNotifications ? 10 : 5],
    queryFn: () => apiClient.listNotifications(showMoreNotifications ? 10 : 5),
    enabled: Boolean(session?.accessToken),
  })

  const unreadCountQuery = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: apiClient.unreadNotificationsCount,
    enabled: Boolean(session?.accessToken),
  })

  const markReadMutation = useMutation({
    mutationFn: apiClient.markNotificationsRead,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
      await queryClient.invalidateQueries({ queryKey: ['notifications', 'unread'] })
    },
  })

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
              <p className="text-xs text-slate-500">AI-assisted LMS quality platform</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              className="relative hidden rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-50 md:inline-flex"
              onClick={() => {
                setNotificationsOpen(true)
                setShowMoreNotifications(false)
                // opening the drawer marks everything read server-side
                markReadMutation.mutate()
              }}
              title="Notifications"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0" />
              </svg>
              {(unreadCountQuery.data?.count ?? 0) > 0 && (
                <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500" />
              )}
            </button>

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

      <Modal
        open={notificationsOpen}
        title="Notifications"
        description="Recent updates for your courses and tasks."
        onClose={() => setNotificationsOpen(false)}
        showHeaderClose
      >
        <div className="space-y-2">
          {(notificationsQuery.data?.length ?? 0) === 0 && (
            <p className="text-sm text-slate-500">No notifications yet.</p>
          )}
          {notificationsQuery.data?.map((notification: any) => {
            const targetPath =
              notification.type === 'CONTENT_POSTED' && notification.entityId
                ? `/content-items/${notification.entityId}`
                : notification.courseId
                  ? `/courses/${notification.courseId}`
                  : '/dashboard'
            return (
              <button
                type="button"
                key={notification.id}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-white"
                onClick={() => {
                  setNotificationsOpen(false)
                  navigate(targetPath)
                }}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {notification.course?.title ?? 'General update'}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900">{notification.title}</p>
                <p className="mt-1 text-sm text-slate-700 line-clamp-2">{notification.message}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(notification.createdAt).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </p>
              </button>
            )
          })}
          {(notificationsQuery.data?.length ?? 0) >= 5 && (
            <div className="pt-1">
              <Button
                variant="ghost"
                className="text-xs"
                onClick={() => setShowMoreNotifications((previous) => !previous)}
              >
                {showMoreNotifications ? 'Show fewer' : 'Show more'}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
