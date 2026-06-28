// Production launcher: load + validate env (reads .env, fails fast on
// misconfig), write process.env (NITRO_PORT + NUXT_* already in process.env
// from the .env parse), then import the Nitro server entry LAST — so env is
// fully in place before Nitro evaluates and reads its listen port.
//
// Why this exists: the .output/ bundle is self-contained and does NOT
// re-evaluate nuxt.config.ts, so the env import there only covers dev/build.
// In production this launcher is the single place that runs env before Nitro.
import env from '../env.js'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

process.env.NITRO_PORT ||= String(env.port)

const here = fileURLToPath(new URL('.', import.meta.url))
const entry = resolve(here, '../.output/server/index.mjs')
await import(entry)
