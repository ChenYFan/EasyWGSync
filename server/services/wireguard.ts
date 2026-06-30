import { execFile } from 'node:child_process'
import { createLogger } from '../utils/logger'

const log = createLogger('WireGuard')

interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

function exec(cmd: string, args: string[], timeoutMs = 5000): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        code: (typeof error?.code === 'number' ? error.code : null) ?? (error ? 1 : 0),
      })
    })
  })
}

export async function getShowEndpoints(configName: string): Promise<Record<string, string>> {
  // Only peers with recent handshake (≤30 min) are considered online.
  const HANDSHAKE_RECENT_MS = 30 * 60 * 1000

  const [endpointsRes, hsRes] = await Promise.all([
    exec('wg', ['show', configName, 'endpoints']),
    exec('wg', ['show', configName, 'latest-handshakes']),
  ])
  if (endpointsRes.code !== 0) {
    log.debug('wg show endpoints failed:', endpointsRes.stderr)
    return {}
  }

  const endpoints: Record<string, string> = {}
  for (const line of endpointsRes.stdout.trim().split('\n')) {
    if (!line) continue
    const [peer, endpoint] = line.split('\t')
    if (peer && endpoint) endpoints[peer] = endpoint
  }

  // latest-handshakes: peer<TAB>unix-seconds (0 = never).
  const handshakes = new Map<string, number>()
  if (hsRes.code === 0) {
    for (const line of hsRes.stdout.trim().split('\n')) {
      if (!line) continue
      const [peer, ts] = line.split('\t')
      if (peer && ts) handshakes.set(peer, Number(ts))
    }
  }

  const now = Date.now()
  const online: Record<string, string> = {}
  for (const [peer, endpoint] of Object.entries(endpoints)) {
    const hs = handshakes.get(peer) || 0
    if (hs > 0 && (now - hs * 1000) <= HANDSHAKE_RECENT_MS) {
      online[peer] = endpoint
    }
  }
  return online
}

export async function derivePubKey(privKey: string): Promise<string | null> {
  const result = await exec('bash', ['-c', `echo '${privKey.replace(/'/g, "'\\''")}' | wg pubkey`])
  if (result.code !== 0) {
    log.debug('wg pubkey derivation failed:', result.stderr)
    return null
  }
  return result.stdout.trim() || null
}
