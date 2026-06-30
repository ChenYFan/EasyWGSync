import type { H3Event } from 'h3'

// Resolve OAuth redirect_uri for Casdoor.
// Priority: 1. explicit config (NUXT_CASDOOR_REDIRECT_URI) → 2. auto-detect from request.
// Honours X-Forwarded-Proto / X-Forwarded-Host (reverse-proxy friendly).
export function resolveRedirectUri(event: H3Event): string {
  const config = useRuntimeConfig()
  if (config.casdoorRedirectUri) {
    return config.casdoorRedirectUri
  }

  const headers = getRequestHeaders(event)
  const proto =
    headers['x-forwarded-proto']?.split(',')[0].trim() ||
    (headers['referer']?.startsWith('https') ? 'https' : 'http')
  const host =
    headers['x-forwarded-host']?.split(',')[0].trim() ||
    headers['host'] ||
    'localhost:3000'

  return `${proto}://${host}/api/auth/callback`
}
