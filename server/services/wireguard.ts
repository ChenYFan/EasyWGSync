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
  const result = await exec('wg', ['show', configName, 'endpoints'])
  if (result.code !== 0) {
    log.debug('wg show endpoints failed:', result.stderr)
    return {}
  }

  const endpoints: Record<string, string> = {}
  for (const line of result.stdout.trim().split('\n')) {
    if (!line) continue
    const [peer, endpoint] = line.split('\t')
    if (peer && endpoint) {
      endpoints[peer] = endpoint
    }
  }
  return endpoints
}

export async function derivePubKey(privKey: string): Promise<string | null> {
  const result = await exec('bash', ['-c', `echo '${privKey.replace(/'/g, "'\\''")}' | wg pubkey`])
  if (result.code !== 0) {
    log.debug('wg pubkey derivation failed:', result.stderr)
    return null
  }
  return result.stdout.trim() || null
}
