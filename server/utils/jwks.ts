// JWT verification against Casdoor's JWKS public keys.
//
// Principle: minimize Casdoor interaction. Public keys are fetched once and
// cached by jose's createRemoteJWKSet; verification is fully local thereafter.
// We refresh the key set at most every 24h (jose also auto-refreshes on unknown
// kid with its own cooldown).

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { createLogger } from './logger'

const log = createLogger('Auth:JWKS')

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
let jwksIssuer = ''
let lastRefresh = 0
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000 // 24h

function getJwks(issuer: string) {
  const now = Date.now()
  // Recreate the key set if issuer changed or 24h elapsed (forces a re-fetch
  // on next verify). jose caches keys internally between these resets.
  if (!jwks || jwksIssuer !== issuer || now - lastRefresh > REFRESH_INTERVAL) {
    // Casdoor exposes JWKS at /.well-known/jwks
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`))
    jwksIssuer = issuer
    lastRefresh = now
    log.log('JWKS key set (re)initialized for', issuer)
  }
  return jwks
}

// Verify a Casdoor-issued JWT (id_token). Local verification using cached keys.
// Throws if signature/issuer/expiry invalid.
export async function verifyToken(token: string, issuer: string): Promise<JWTPayload> {
  const keySet = getJwks(issuer)
  const { payload } = await jwtVerify(token, keySet, {
    // Casdoor sets `iss` to the issuer URL
    issuer,
  })
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
