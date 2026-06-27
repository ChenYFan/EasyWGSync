interface AuthState {
  authenticated: boolean
  user: { userId: string; username: string; avatar?: string } | null
}

const TOKEN_KEY = 'wgsync_token'

export const useAuth = () => useState<AuthState>('auth', () => ({
  authenticated: false,
  user: null,
}))

// JWT token stored in localStorage (Casdoor id_token). Client-side only.
export function getToken(): string | null {
  if (import.meta.server) return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  if (import.meta.server) return
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  if (import.meta.server) return
  localStorage.removeItem(TOKEN_KEY)
}

// Authenticated $fetch wrapper: injects Authorization: Bearer <jwt>.
// On 401, clears the token and redirects to /login.
export function authFetch<T = any>(url: string, opts: any = {}): Promise<T> {
  const token = getToken()
  const headers = { ...(opts.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  return ($fetch as any)(url, {
    ...opts,
    headers,
    onResponseError({ response }: any) {
      if (response?.status === 401) {
        clearToken()
        if (import.meta.client) navigateTo('/login')
      }
      opts.onResponseError?.({ response })
    },
  }) as Promise<T>
}
