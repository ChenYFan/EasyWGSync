#!/usr/bin/env node
// One-time migration: Split env.json into .env + data/config.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const envJsonPath = join(root, 'env.json')

if (!existsSync(envJsonPath)) {
  console.error('env.json not found in current directory')
  process.exit(1)
}

const env = JSON.parse(readFileSync(envJsonPath, 'utf-8'))

// Extract secrets → .env
const dotenv = `# Generated from env.json migration
NUXT_SECRET=${env.SECRET}
NUXT_WIREGUARD_CONFIG_NAME=${env.WIREGUARD_CONFIGNAME}
NUXT_WIREGUARD_DASHBOARD_URL=${env.WIREGUARD_DASHBOARD_URL}
NUXT_WIREGUARD_DASHBOARD_API_KEY=${env.WIREGUARD_DASHBOARD_APIKEY}

# Casdoor (fill in manually)
NUXT_CASDOOR_ISSUER=
NUXT_CASDOOR_CLIENT_ID=
NUXT_CASDOOR_CLIENT_SECRET=
NUXT_CASDOOR_REDIRECT_URI=http://localhost:3000/callback

# Session
NUXT_SESSION_SECRET=${crypto.randomUUID().replace(/-/g, '')}
`

// Extract topology → data/config.json
const config = {
  GLOBAL_LISTEN_PORT: env.GLOBAL_LISTEN_PORT || null,
  GLOBAL_DNS: env.GLOBAL_DNS ?? true,
  GLOBAL_SCRIPTS: env.GLOBAL_SCRIPTS || {},
  MESH_GROUPS: env.MESH_GROUPS || {},
  EXTRA_CONFIG: env.EXTRA_CONFIG || {},
}

mkdirSync(join(root, 'data'), { recursive: true })
writeFileSync(join(root, '.env'), dotenv, 'utf-8')
writeFileSync(join(root, 'data', 'config.json'), JSON.stringify(config, null, 2), 'utf-8')

console.log('✓ Created .env (secrets)')
console.log('✓ Created data/config.json (topology)')
console.log('')
console.log('Next: fill in NUXT_CASDOOR_* values in .env')
