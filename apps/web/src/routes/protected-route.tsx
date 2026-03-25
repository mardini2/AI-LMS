// goal: require a stored JWT session before showing any in-app shell routes.

import { Navigate, Outlet } from 'react-router-dom'
import { authStorage } from '../features/auth/auth-storage'

export function ProtectedRoute() {
  const session = authStorage.get()
  if (!session) return <Navigate to="/login" replace />
  return <Outlet />
}
