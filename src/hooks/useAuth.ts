import { create } from 'zustand'

interface User {
  id: string
  username: string
  fullName: string
  roleCode: string
  userLevel: number
  department?: { code: string; name: string }
}

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  login: (token: string, user: User) => void
  logout: () => void
  hydrate: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  login: (token: string, user: User) => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('ibs_token', token)
      sessionStorage.setItem('ibs_user', JSON.stringify(user))
    }
    set({ token, user, isAuthenticated: true })
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('ibs_token')
      sessionStorage.removeItem('ibs_user')
    }
    set({ token: null, user: null, isAuthenticated: false })
  },

  hydrate: () => {
    if (typeof window === 'undefined') return
    const token = sessionStorage.getItem('ibs_token')
    const userStr = sessionStorage.getItem('ibs_user')
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User
        set({ token, user, isAuthenticated: true })
      } catch {
        set({ token: null, user: null, isAuthenticated: false })
      }
    }
  },
}))

// Auth-aware fetch helper
export async function apiFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(url, { ...options, headers })
  const data = await res.json()

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('ibs_token')
      sessionStorage.removeItem('ibs_user')
      window.location.href = '/login'
    }
  }

  return data
}
