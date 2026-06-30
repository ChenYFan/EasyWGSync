import { readFile, writeFile, rename, mkdir, unlink, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { SyncConfigSchema } from '../utils/schemas'
import { createLogger } from '../utils/logger'
import type { SyncConfig } from '~/types'

const log = createLogger('Storage')

const DATA_DIR = join(process.cwd(), 'data')
const CONFIG_PATH = join(DATA_DIR, 'config.json')
const LOCK_PATH = join(DATA_DIR, '.config.lock')

const DEFAULT_CONFIG: SyncConfig = {
  GLOBAL_LISTEN_PORT: null,
  GLOBAL_DNS: true,
  GLOBAL_SCRIPTS: {},
  MESH_GROUPS: {},
  EXTRA_CONFIG: {},
}

let lockHolder: ReturnType<typeof setTimeout> | null = null

async function acquireLock(timeoutMs = 5000): Promise<void> {
  // Ensure DATA_DIR exists before writing lock file.
  await mkdir(DATA_DIR, { recursive: true })
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const lockStat = await stat(LOCK_PATH).catch(() => null)
      if (lockStat) {
        if (Date.now() - lockStat.mtimeMs > 10000) {
          await unlink(LOCK_PATH).catch(() => {})
        } else {
          await new Promise(r => setTimeout(r, 50))
          continue
        }
      }
      await writeFile(LOCK_PATH, String(process.pid), { flag: 'wx' })
      return
    } catch {
      await new Promise(r => setTimeout(r, 50))
    }
  }
  throw new Error('Failed to acquire config lock')
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_PATH).catch(() => {})
}

/**
 * config.json last-modified time. Used as config version in each peer .conf
 * so ewctl can skip re-apply when unchanged.
 */
export async function getConfigMtime(): Promise<number> {
  try {
    return (await stat(CONFIG_PATH)).mtimeMs
  } catch {
    return 0
  }
}

export async function readSyncConfig(): Promise<SyncConfig> {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG }
  }
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    return SyncConfigSchema.parse(JSON.parse(raw))
  } catch (e) {
    log.error('Failed to read config, returning default:', e)
    return { ...DEFAULT_CONFIG }
  }
}

export async function writeSyncConfig(config: SyncConfig): Promise<void> {
  const validated = SyncConfigSchema.parse(config)
  const tmpFile = join(DATA_DIR, `.config-${randomBytes(8).toString("hex")}.tmp`)

  await acquireLock()
  try {
    await writeFile(tmpFile, JSON.stringify(validated, null, 2), 'utf-8')
    await rename(tmpFile, CONFIG_PATH)
  } finally {
    await releaseLock()
  }
}

export async function updateSyncConfig(
  updater: (current: SyncConfig) => SyncConfig
): Promise<SyncConfig> {
  await acquireLock()
  try {
    const current = await readSyncConfig()
    const updated = updater(current)
    const validated = SyncConfigSchema.parse(updated)

    const tmpFile = join(DATA_DIR, `.config-${randomBytes(8).toString("hex")}.tmp`)
    await writeFile(tmpFile, JSON.stringify(validated, null, 2), 'utf-8')
    await rename(tmpFile, CONFIG_PATH)

    return validated
  } finally {
    await releaseLock()
  }
}
