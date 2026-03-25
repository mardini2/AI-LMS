// goal: gate /admin/* so only local session role ADMIN can render child routes.

import { Navigate, Outlet } from 'react-router-dom'
import { authStorage } from '../features/auth/auth-storage'

export function AdminRoute() {
  const session = authStorage.get()
  if (!session) return <Navigate to="/login" replace />
  if (session.user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />
  return <Outlet />
}
