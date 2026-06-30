// JWT verification against Casdoor's JWKS. Keys fetched once, cached 24h.
// Local verification thereafter — no per-request Casdoor calls.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { createLogger } from './logger'

const log = createLogger('Auth:JWKS')

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
let jwksIssuer = ''
let lastRefresh = 0
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000 // 24h

function getJwks(issuer: string) {
  const now = Date.now()
  // Recreate key set if issuer changed or >24h elapsed.
  if (!jwks || jwksIssuer !== issuer || now - lastRefresh > REFRESH_INTERVAL) {
    // Casdoor exposes JWKS at /.well-known/jwks
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`))
    jwksIssuer = issuer
    lastRefresh = now
    log.log('JWKS key set (re)initialized for', issuer)
  }
  return jwks
}

// Verify a Casdoor-issued JWT locally against cached keys.
export async function verifyToken(token: string, issuer: string): Promise<JWTPayload> {
  const keySet = getJwks(issuer)
  const { payload } = await jwtVerify(token, keySet, { issuer })
  return payload
}

// Pre-warm the key set at startup so the first login verifies without delay.
export function prewarmJwks(issuer: string): void {
  if (!issuer) return
  try {
    getJwks(issuer)
  } catch (e) {
    log.error('JWKS prewarm failed:', e)
  }
}
