import type { H3Event } from 'h3'

// Resolve the OAuth redirect_uri for the Casdoor flow.
//
// Priority:
//  1. Explicit config (NUXT_CASDOOR_REDIRECT_URI) — use verbatim if set.
//  2. Auto-detect from the incoming request: scheme + host + /api/auth/callback.
//     Honours X-Forwarded-Proto / X-Forwarded-Host (set by reverse proxies)
//     so it works behind nginx/Caddy without hardcoding the domain.
//
// OAuth requires the redirect_uri in the authorize request and the token
// exchange to be byte-identical, so BOTH login.get.ts and callback.get.ts
// must call this same helper.
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
