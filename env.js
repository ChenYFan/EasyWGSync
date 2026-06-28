// env.js — single source of truth for configuration.
//
// Parses the project-root `.env` itself at module-eval time (so production
// runtime reads it too, not just dev/build), validates required fields / types
// / ranges / URLs (throws on violation so a misconfigured server refuses to
// start), and exports a typed config object.
//
// Injection into the app happens BEFORE Nitro reads its listen port:
//  - dev/build: nuxt.config.ts imports this file at top level and writes
//    process.env.NITRO_PORT before defineNuxtConfig runs.
//  - production: scripts/start-prod.mjs imports this file, writes
//    process.env (NITRO_PORT + NUXT_*), then `await import()`s the Nitro
//    server entry — so env is in place before Nitro evaluates.
// A nitro plugin is NOT used for port/env injection (runNitroPlugins doesn't
// await async plugins, so it would race Nitro's port read).

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Parse .env into a plain object. Simple KEY=VALUE, quotes stripped, # comments skipped. */
function parseDotenv(text) {
  const out = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\n/g, '\n')
    } else {
      const hash = value.indexOf(' #')
      if (hash !== -1) value = value.slice(0, hash).trim()
    }
    if (key) out[key] = value
  }
  return out
}

// Load .env into process.env at module-eval time. Real env vars win (never clobber).
try {
  for (const [key, val] of Object.entries(parseDotenv(readFileSync(join(__dirname, '.env'), 'utf-8')))) {
    if (process.env[key] === undefined) process.env[key] = val
  }
} catch { /* no .env file — rely on process.env (systemd/docker) */ }

// --- typed readers ---
const S = (key, d = '') => (process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : d)
const I = (key, d) => { const v = parseInt(process.env[key], 10); return Number.isFinite(v) ? v : d }
const B = (key, d = false) => (process.env[key] === undefined ? d : ['true', '1', 'yes'].includes(process.env[key].toLowerCase()))

// --- validation (fail-fast: throw on violation so the server refuses to start) ---
function requireStr(key) {
  const v = process.env[key]
  if (!v) throw new Error(`[env] 缺失必填项 ${key}`)
  return v
}
function requireUrl(key) {
  const v = requireStr(key)
  try { /* eslint-disable no-new */ new URL(v) } catch { throw new Error(`[env] ${key} 不是合法 URL: ${v}`) }
  return v
}
function rangeInt(key, min, max, d) {
  const v = I(key, d)
  if (v < min || v > max) throw new Error(`[env] ${key}=${v} 超出范围 [${min}, ${max}]`)
  return v
}

// --- the typed config object ---
const config = {
  secret: requireStr('NUXT_SECRET'),
  wireguardConfigName: requireStr('NUXT_WIREGUARD_CONFIG_NAME'),
  wireguardDashboardUrl: requireUrl('NUXT_WIREGUARD_DASHBOARD_URL'),
  wireguardDashboardApiKey: requireStr('NUXT_WIREGUARD_DASHBOARD_API_KEY'),
  casdoorIssuer: S('NUXT_CASDOOR_ISSUER'),
  casdoorClientId: S('NUXT_CASDOOR_CLIENT_ID'),
  casdoorClientSecret: S('NUXT_CASDOOR_CLIENT_SECRET'),
  casdoorRedirectUri: S('NUXT_CASDOOR_REDIRECT_URI'),
  sessionSecret: requireStr('NUXT_SESSION_SECRET'),
  // Port: read NUXT_PORT (the .env convention), validate range, bridge to
  // NITRO_PORT (what Nitro's listener actually reads). Real NITRO_PORT/PORT
  // env wins over NUXT_PORT.
  port: rangeInt('NITRO_PORT', 1, 65535, I('NUXT_PORT', 3000)),
}

// Bridge NUXT_PORT → NITRO_PORT so Nitro's listener picks it up. NITRO_PORT
// already set (real env) wins.
process.env.NITRO_PORT ||= String(config.port)

export default config
