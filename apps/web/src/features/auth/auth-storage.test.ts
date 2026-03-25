// goal: test authStorage against an in-memory Storage fake instead of real localStorage.

import { beforeEach, describe, expect, it } from 'vitest'
import { authStorage, type AuthSession } from './auth-storage'

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

describe('authStorage', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    })
  })

  it('stores and retrieves a valid auth session', () => {
    const session: AuthSession = {
      accessToken: 'token',
      user: {
        sub: 'u1',
        email: 'user@example.com',
        role: 'STUDENT',
        fullName: 'User',
      },
    }

    authStorage.set(session)

    expect(authStorage.get()).toEqual(session)
  })

  it('returns null when persisted json is malformed', () => {
    localStorage.setItem('syllentra.auth.session', '{bad json')

    expect(authStorage.get()).toBeNull()
  })

  it('clears stored session', () => {
    localStorage.setItem('syllentra.auth.session', '{"x":1}')

    authStorage.clear()

    expect(localStorage.getItem('syllentra.auth.session')).toBeNull()
  })
})
