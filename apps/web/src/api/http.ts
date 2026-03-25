// goal: shared axios instance with JWT header injection and 401 redirect to login.

import axios from 'axios'
import { authStorage } from '../features/auth/auth-storage'

export const http = axios.create({
  baseURL: '/api',
  // Keep a reasonable default. Longer operations can override per-request timeout.
  timeout: 30000,
})

http.interceptors.request.use((config) => {
  const session = authStorage.get()
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    // expired or revoked token: wipe local session and send user to login
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      authStorage.clear()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }
    return Promise.reject(error)
  },
)
