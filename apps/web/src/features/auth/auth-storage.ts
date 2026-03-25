// goal: tiny localStorage helpers for JWT + user snapshot after login.

export interface AuthUser {
  sub: string
  email: string
  role: 'ADMIN' | 'INSTRUCTOR' | 'REVIEWER' | 'STUDENT'
  fullName: string
}

export interface AuthSession {
  accessToken: string
  user: AuthUser
}

const STORAGE_KEY = 'syllentra.auth.session'

export const authStorage = {
  get(): AuthSession | null {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    try {
      // tolerate manual edits in dev without crashing the whole app
      return JSON.parse(raw) as AuthSession
    } catch {
      return null
    }
  },
  set(session: AuthSession) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  },
  clear() {
    localStorage.removeItem(STORAGE_KEY)
  },
}
