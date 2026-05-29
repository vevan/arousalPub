import { useAuthStore } from '@/stores/auth'

export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const auth = useAuthStore()
  const headers = new Headers(init?.headers)
  if (auth.token) {
    headers.set('Authorization', `Bearer ${auth.token}`)
  }
  return fetch(input, { ...init, headers })
}
