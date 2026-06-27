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
      document.cookie = `ibs_token=${token}; path=/api/upload; SameSite=Strict`
    }
    set({ token, user, isAuthenticated: true })
  },

  logout: () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('ibs_token')
      sessionStorage.removeItem('ibs_user')
      document.cookie = 'ibs_token=; path=/api/upload; max-age=0'
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
        document.cookie = `ibs_token=${token}; path=/api/upload; SameSite=Strict`
        set({ token, user, isAuthenticated: true })
      } catch {
        set({ token: null, user: null, isAuthenticated: false })
      }
    }
  },
}))

const INLINE_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain', 'text/csv',
])

export async function openAuthedFile(id: string, fileName: string, mimeType?: string | null) {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
  try {
    const res = await fetch(`/api/upload/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      const msg = await res.json().then(d => d.error).catch(() => res.statusText)
      alert(`Không tải được file: ${msg}`)
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const mime = mimeType || blob.type || ''
    if (INLINE_MIME.has(mime)) {
      const w = window.open(url, '_blank')
      if (w) {
        const timer = setTimeout(() => URL.revokeObjectURL(url), 60_000)
        w.addEventListener('beforeunload', () => { clearTimeout(timer); URL.revokeObjectURL(url) })
      }
    } else {
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5_000)
    }
  } catch {
    alert('Không tải được file — lỗi mạng')
  }
}

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
