const LEVELS = { debug: 0, log: 1, warn: 2, error: 3 } as const
type Level = keyof typeof LEVELS

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',
  log: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}
const RESET = '\x1b[0m'

export function createLogger(prefix: string) {
  const emit = (level: Level, ...args: unknown[]) => {
    const ts = new Date().toISOString()
    console[level === 'log' ? 'log' : level](
      `${COLORS[level]}[${ts}] [${prefix}] [${level.toUpperCase()}]${RESET}`,
      ...args
    )
  }

  return {
    debug: (...args: unknown[]) => emit('debug', ...args),
    log: (...args: unknown[]) => emit('log', ...args),
    warn: (...args: unknown[]) => emit('warn', ...args),
    error: (...args: unknown[]) => emit('error', ...args),
  }
}
