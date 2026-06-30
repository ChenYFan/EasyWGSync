// Production launcher: load env → write NITRO_PORT → import Nitro server.
// Installs SIGINT/SIGTERM handlers before Nitro for instant shutdown.

import env from '../env.js'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

process.env.NITRO_PORT ||= String(env.port)

// Instant shutdown: bypasses Nitro's GracefulShutdown timeout.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => process.exit(0))
}

const here = fileURLToPath(new URL('.', import.meta.url))
const entry = resolve(here, '../.output/server/index.mjs')
await import(entry)
